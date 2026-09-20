import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { userCanAccessChannel, areFriends, dmRoomName } from '../common/access-checks';

interface SocketUser {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
}

type TypingStatus = 'typing' | 'recording' | null;

function channelRoom(channelId: string): string {
  return `channel:${channelId}`;
}

// Sending still goes through the existing REST endpoints (validated,
// idempotent-ish, already tested) -- this gateway's only job is auth,
// room membership (re-checked server-side, never trusted from the client),
// and pushing events after a REST write succeeds. Scaling to multiple
// server instances is handled in main.ts via the Redis adapter -- this
// class doesn't need to know or care whether it's one instance or ten,
// server.to(room).emit(...) works the same either way once that's wired up.
@WebSocketGateway({ cors: { origin: '*' } })
@Injectable()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  // Live connection count per user, not just a boolean -- someone can have
  // the app open in two tabs, and shouldn't flip to "offline" when only one
  // of them closes. In-memory, so this is accurate for a single backend
  // instance; scaling to multiple instances would need this moved to Redis
  // (same as the WebSocket adapter itself), not attempted here.
  private onlineCounts = new Map<string, number>();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  // Runs after the auth middleware below has already set client.data.user --
  // Socket.IO guarantees middleware completes before 'connection' fires.
  handleConnection(client: Socket) {
    const user = this.currentUser(client);
    if (!user) return;
    const count = this.onlineCounts.get(user.id) ?? 0;
    this.onlineCounts.set(user.id, count + 1);
    if (count === 0) this.server.emit('presence:online', { userId: user.id });
  }

  handleDisconnect(client: Socket) {
    const user = this.currentUser(client);
    if (!user) return;
    const count = this.onlineCounts.get(user.id) ?? 0;
    if (count <= 1) {
      this.onlineCounts.delete(user.id);
      this.server.emit('presence:offline', { userId: user.id });
    } else {
      this.onlineCounts.set(user.id, count - 1);
    }
  }

  getOnlineUserIds(): string[] {
    return [...this.onlineCounts.keys()];
  }

  // Auth lives in connection middleware, not the handleConnection lifecycle
  // hook. Socket.IO guarantees middleware completes -- including our async
  // JWT verify + DB lookup -- before the handshake finishes, i.e. before the
  // client ever sees its own 'connect' event fire. Doing this in
  // handleConnection instead is a real race: the client can consider itself
  // connected and immediately emit 'channel:join' before that async work
  // resolves, so client.data.user isn't set yet and the join is silently
  // dropped. Confirmed by hitting exactly that race in testing.
  afterInit(server: Server) {
    server.use(async (socket: Socket, next: (err?: Error) => void) => {
      try {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) throw new Error('No token provided');

        const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) throw new Error('User not found');
        if (!user.isActive) throw new Error('Account deactivated');

        const socketUser: SocketUser = { id: user.id, email: user.email, username: user.username, isAdmin: user.isAdmin };
        socket.data.user = socketUser;
        next();
      } catch (err) {
        this.logger.warn(`Rejected socket connection: ${(err as Error).message}`);
        next(err as Error);
      }
    });
  }

  private currentUser(client: Socket): SocketUser | undefined {
    return client.data?.user as SocketUser | undefined;
  }

  // ── Channel rooms ─────────────────────────────────────────────

  @SubscribeMessage('channel:join')
  async joinChannel(@ConnectedSocket() client: Socket, @MessageBody() data: { channelId: string }) {
    const user = this.currentUser(client);
    if (!user || !data?.channelId) return;

    const allowed = await userCanAccessChannel(this.prisma, user.id, user.isAdmin, data.channelId);
    if (!allowed) return;

    client.join(channelRoom(data.channelId));
  }

  @SubscribeMessage('channel:leave')
  leaveChannel(@ConnectedSocket() client: Socket, @MessageBody() data: { channelId: string }) {
    if (!data?.channelId) return;
    client.leave(channelRoom(data.channelId));
  }

  emitChannelMessage(channelId: string, message: unknown) {
    this.server.to(channelRoom(channelId)).emit('channel:message', message);
  }

  // "@user is typing..." / "...is recording a voice message" indicator.
  // status: null clears it (message sent, input cleared, recording
  // paused/discarded). Re-checks channel access same as joinChannel --
  // room names are guessable, so an emit here shouldn't be trusted just
  // because the client claims a channelId. client.to() (not server.to())
  // deliberately excludes the sender's own socket.
  @SubscribeMessage('channel:typing')
  async channelTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string; status: TypingStatus },
  ) {
    const user = this.currentUser(client);
    if (!user || !data?.channelId) return;

    const allowed = await userCanAccessChannel(this.prisma, user.id, user.isAdmin, data.channelId);
    if (!allowed) return;

    client.to(channelRoom(data.channelId)).emit('channel:typing', {
      channelId: data.channelId,
      userId: user.id,
      username: user.username,
      status: data.status ?? null,
    });
  }

  // ── Direct-message rooms ──────────────────────────────────────

  @SubscribeMessage('dm:join')
  async joinDm(@ConnectedSocket() client: Socket, @MessageBody() data: { friendId: string }) {
    const user = this.currentUser(client);
    if (!user || !data?.friendId) return;

    const friends = await areFriends(this.prisma, user.id, data.friendId);
    if (!friends) return;

    client.join(dmRoomName(user.id, data.friendId));
  }

  @SubscribeMessage('dm:leave')
  leaveDm(@ConnectedSocket() client: Socket, @MessageBody() data: { friendId: string }) {
    const user = this.currentUser(client);
    if (!user || !data?.friendId) return;
    client.leave(dmRoomName(user.id, data.friendId));
  }

  emitDirectMessage(userAId: string, userBId: string, message: unknown) {
    this.server.to(dmRoomName(userAId, userBId)).emit('dm:message', message);
  }

  // Same idea as channel:typing, scoped to a DM pair.
  @SubscribeMessage('dm:typing')
  async dmTyping(@ConnectedSocket() client: Socket, @MessageBody() data: { friendId: string; status: TypingStatus }) {
    const user = this.currentUser(client);
    if (!user || !data?.friendId) return;

    const friends = await areFriends(this.prisma, user.id, data.friendId);
    if (!friends) return;

    client.to(dmRoomName(user.id, data.friendId)).emit('dm:typing', {
      userId: user.id,
      username: user.username,
      status: data.status ?? null,
    });
  }
}
