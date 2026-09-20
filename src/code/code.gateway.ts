import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { userCanAccessChannel } from '../common/access-checks';
import { CodeSyncService } from './code-sync.service';

interface SocketUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

const DEFAULT_PATH = 'main';

function codeRoom(channelId: string, path: string): string {
  return `code:${channelId}:${path}`;
}

/**
 * Where one person's caret and selection currently are.
 *
 * Positions are Yjs *relative* positions (opaque bytes to this server):
 * they point at a character's identity rather than an offset, so a cursor
 * stays attached to the right spot even as other people insert text above
 * it. Only the client, which holds the document, can resolve them.
 *
 * Keyed by socket id, not user id: the same person can have two tabs open,
 * and each has its own caret.
 */
interface CursorState {
  userId: string;
  username: string;
  anchor: Uint8Array | null;
  head: Uint8Array | null;
}

/**
 * Carries CRDT updates between everyone editing the same document.
 *
 * This shares the Socket.IO server (and therefore the JWT middleware and
 * the live connection) that ChatGateway already set up -- a second gateway
 * class on the same namespace, not a second connection. So a user editing
 * code is authenticated exactly once, and chat and code travel the same
 * pipe.
 *
 * Updates are sent as raw binary: Socket.IO handles Uint8Array natively,
 * so there's no base64 step (which would inflate every keystroke by ~33%).
 */
@WebSocketGateway({ cors: { origin: '*' } })
@Injectable()
export class CodeGateway implements OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CodeGateway.name);

  // room -> socketId -> cursor. Purely ephemeral: never persisted, and
  // dropped the moment a socket leaves. Held here rather than in
  // CodeSyncService because it isn't part of the document -- you don't
  // want other people's carets in your file's saved history.
  private readonly cursors = new Map<string, Map<string, CursorState>>();

  constructor(
    private prisma: PrismaService,
    private codeSync: CodeSyncService,
  ) {}

  private currentUser(client: Socket): SocketUser | undefined {
    return client.data?.user as SocketUser | undefined;
  }

  /**
   * Every handler re-checks channel access rather than trusting that the
   * client is in the room. Room names are guessable, and a user's access
   * can be revoked while they're connected -- the check is one indexed
   * query, and it's the only thing standing between a locked channel and
   * anyone who can open a socket.
   */
  private async authorize(client: Socket, channelId: string): Promise<SocketUser | null> {
    const user = this.currentUser(client);
    if (!user || !channelId) return null;

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { kind: true },
    });
    if (!channel || channel.kind !== 'CODE') return null;

    const allowed = await userCanAccessChannel(this.prisma, user.id, user.isAdmin, channelId);
    return allowed ? user : null;
  }

  /**
   * Step 1 of the sync handshake. The client sends a *state vector*: a
   * compact "here's what I already have" summary (bytes, not the document).
   * We reply with only what it's missing, plus our own state vector so it
   * can work out what we're missing and send that back as an update.
   *
   * Two round trips, and both sides end up identical -- whether the client
   * is brand new, refreshing, or reconnecting after editing offline.
   */
  @SubscribeMessage('code:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string; path?: string; stateVector?: ArrayBuffer | UintFriendly },
  ) {
    const path = data?.path ?? DEFAULT_PATH;
    const user = await this.authorize(client, data?.channelId);
    if (!user) return { error: 'forbidden' };

    client.join(codeRoom(data.channelId, path));

    const { update, stateVector } = await this.codeSync.join(
      data.channelId,
      path,
      client.id,
      toUint8Array(data.stateVector),
    );

    // Returned as an ack rather than a separate emit, so the client can
    // await the handshake instead of racing a listener against its own
    // first keystroke. `cursors` is a snapshot of who's already here --
    // without it a newcomer would see nobody until they each moved.
    return {
      update,
      stateVector,
      cursors: this.snapshotCursors(codeRoom(data.channelId, path), client.id),
    };
  }

  private snapshotCursors(room: string, excludeSocketId: string) {
    const roomCursors = this.cursors.get(room);
    if (!roomCursors) return [];
    return [...roomCursors.entries()]
      .filter(([socketId]) => socketId !== excludeSocketId)
      .map(([socketId, state]) => ({ socketId, ...state }));
  }

  /**
   * Relays one person's caret/selection to everyone else in the document.
   *
   * Note this checks room membership instead of re-running the full access
   * query the way code:update does. Cursor events fire on every caret move
   * -- several per second per person -- and two database round trips each
   * would be a real load. Membership is only granted by code:join, which
   * *is* fully access-checked, and the payload carries no document content
   * (just opaque position bytes), so the weaker check is proportionate.
   *
   * Identity is taken from the socket's authenticated session, never from
   * the client's payload -- otherwise anyone could label their cursor with
   * someone else's name.
   */
  @SubscribeMessage('code:cursor')
  cursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string; path?: string; anchor?: ArrayBuffer | UintFriendly; head?: ArrayBuffer | UintFriendly },
  ) {
    const user = this.currentUser(client);
    if (!user || !data?.channelId) return;

    const path = data.path ?? DEFAULT_PATH;
    const room = codeRoom(data.channelId, path);
    if (!client.rooms.has(room)) return;

    const state: CursorState = {
      userId: user.id,
      username: user.username,
      anchor: toUint8Array(data.anchor),
      head: toUint8Array(data.head),
    };

    let roomCursors = this.cursors.get(room);
    if (!roomCursors) {
      roomCursors = new Map();
      this.cursors.set(room, roomCursors);
    }
    roomCursors.set(client.id, state);

    client.to(room).emit('code:cursor', {
      channelId: data.channelId,
      path,
      socketId: client.id,
      ...state,
    });
  }

  // Someone's caret must disappear when they go, or it hangs in the
  // document forever looking like a live collaborator.
  private dropCursor(room: string, socketId: string, channelId: string, path: string) {
    const roomCursors = this.cursors.get(room);
    if (!roomCursors?.delete(socketId)) return;
    if (roomCursors.size === 0) this.cursors.delete(room);
    this.server.to(room).emit('code:cursor-left', { channelId, path, socketId });
  }

  /**
   * Step 2, then the steady state: one client's edit, applied to the
   * server's copy and fanned out to everyone else in the room.
   *
   * client.to() excludes the sender -- it already has its own change, and
   * echoing it back would be pure waste (harmless though: applying your
   * own update twice is a no-op in a CRDT).
   */
  @SubscribeMessage('code:update')
  async update(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string; path?: string; update: ArrayBuffer | UintFriendly },
  ) {
    const path = data?.path ?? DEFAULT_PATH;
    const user = await this.authorize(client, data?.channelId);
    if (!user) return { error: 'forbidden' };

    const update = toUint8Array(data.update);
    if (!update || update.length === 0) return { ok: true };

    try {
      await this.codeSync.applyUpdate(data.channelId, path, update);
    } catch (err) {
      // A corrupt or truncated update must not take the process down.
      this.logger.warn(`Rejected bad update on ${data.channelId}/${path}: ${(err as Error).message}`);
      return { error: 'bad-update' };
    }

    client.to(codeRoom(data.channelId, path)).emit('code:update', {
      channelId: data.channelId,
      path,
      update,
    });

    return { ok: true };
  }

  @SubscribeMessage('code:leave')
  leave(@ConnectedSocket() client: Socket, @MessageBody() data: { channelId: string; path?: string }) {
    if (!data?.channelId) return;
    const path = data.path ?? DEFAULT_PATH;
    const room = codeRoom(data.channelId, path);
    this.dropCursor(room, client.id, data.channelId, path);
    client.leave(room);
    this.codeSync.leave(data.channelId, path, client.id);
  }

  // Closing the tab never sends code:leave, so without this every document
  // would look permanently occupied -- never evicted, never finally saved,
  // and with a ghost caret sitting in it.
  handleDisconnect(client: Socket) {
    for (const [room, roomCursors] of this.cursors) {
      if (!roomCursors.has(client.id)) continue;
      // room name is `code:<channelId>:<path>`
      const [, channelId, path] = room.split(':');
      this.dropCursor(room, client.id, channelId, path);
    }
    this.codeSync.leaveAll(client.id);
  }
}

// Socket.IO hands binary through as Buffer (Node) or ArrayBuffer depending
// on the client, so normalize before Yjs sees it.
type UintFriendly = Uint8Array | Buffer | number[];

function toUint8Array(value: ArrayBuffer | UintFriendly | undefined | null): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}
