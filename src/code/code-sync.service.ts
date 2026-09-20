import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';

// How long after the last edit we write the document to Postgres. Every
// keystroke produces an update; persisting each one would mean a write per
// character. The in-memory doc is the live source of truth between saves.
const PERSIST_DEBOUNCE_MS = 2000;

// How long an idle document stays in memory after the last editor leaves.
// Keeping it briefly makes refreshes and flaky connections cheap (no
// reload from Postgres); evicting eventually stops memory growing forever.
const EVICT_AFTER_IDLE_MS = 60_000;

interface LoadedDoc {
  doc: Y.Doc;
  /** Socket ids currently editing. Empty set starts the eviction clock. */
  members: Set<string>;
  persistTimer: ReturnType<typeof setTimeout> | null;
  evictTimer: ReturnType<typeof setTimeout> | null;
  /** True when the in-memory doc has changes not yet written to Postgres. */
  dirty: boolean;
}

/**
 * Owns the server-side copy of every open code document.
 *
 * Why the server holds a Y.Doc at all, rather than blindly relaying bytes
 * between clients: someone has to be able to answer "what does this
 * document look like right now?" for a person who just opened it, and
 * something has to write it to the database. A relay can't do either --
 * it would have to ask an existing client, which fails when nobody is
 * connected.
 *
 * Because Yjs updates are commutative and idempotent, this server copy
 * needs no locking, no ordering guarantees and no conflict resolution:
 * applying the same updates in any order, even twice, always converges to
 * the same document.
 *
 * SCALING LIMIT (single instance): these docs live in this process's
 * memory. Run two backend instances and each gets its own copy of the same
 * document, so each would persist a version missing the other's edits.
 * Fixing that means pinning a document to one instance (sticky routing) or
 * moving this state into Redis -- see the notes in the README/plan.
 */
@Injectable()
export class CodeSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(CodeSyncService.name);
  private readonly docs = new Map<string, LoadedDoc>();

  constructor(private prisma: PrismaService) {}

  private key(channelId: string, path: string) {
    return `${channelId}:${path}`;
  }

  /**
   * Returns the live doc for a channel, loading it from Postgres the first
   * time. Concurrent callers get the same instance -- the map is checked
   * before the await, and the row is only read when nothing is cached.
   */
  private async load(channelId: string, path: string): Promise<LoadedDoc> {
    const key = this.key(channelId, path);
    const cached = this.docs.get(key);
    if (cached) return cached;

    const row = await this.prisma.codeDocument.upsert({
      where: { channelId_path: { channelId, path } },
      update: {},
      create: { channelId, path },
    });

    // Re-check: another caller may have loaded it while we were awaiting.
    const raced = this.docs.get(key);
    if (raced) return raced;

    const doc = new Y.Doc();
    if (row.ystate) {
      // Rebuilding from the stored update replays the document's history,
      // which is what lets an edit made offline still merge correctly.
      Y.applyUpdate(doc, new Uint8Array(row.ystate));
    } else if (row.content) {
      // Document predates CRDT storage (Phase 0 wrote plain text only) --
      // seed the CRDT with that text so nothing is lost on first open.
      doc.getText('content').insert(0, row.content);
    }

    const entry: LoadedDoc = { doc, members: new Set(), persistTimer: null, evictTimer: null, dirty: false };
    this.docs.set(key, entry);
    return entry;
  }

  /**
   * Called when a client joins. Returns the updates that client is missing,
   * computed from the state vector it sent (a compact summary of what it
   * already has). A brand-new client sends an empty vector and gets the
   * whole document; a reconnecting one gets only what changed while it was
   * away.
   */
  async join(channelId: string, path: string, socketId: string, clientStateVector: Uint8Array | null) {
    const entry = await this.load(channelId, path);
    entry.members.add(socketId);
    if (entry.evictTimer) { clearTimeout(entry.evictTimer); entry.evictTimer = null; }

    return {
      // What the client is missing from us.
      update: Y.encodeStateAsUpdate(entry.doc, clientStateVector ?? undefined),
      // What we have, so the client can compute what *we're* missing
      // (edits it made while disconnected) and send those back.
      stateVector: Y.encodeStateVector(entry.doc),
    };
  }

  /** Applies one client's update to the server copy and schedules a save. */
  async applyUpdate(channelId: string, path: string, update: Uint8Array) {
    const entry = await this.load(channelId, path);
    Y.applyUpdate(entry.doc, update);
    entry.dirty = true;
    this.schedulePersist(channelId, path, entry);
  }

  /** Lets a reconnecting client ask for exactly what it missed. */
  async diffSince(channelId: string, path: string, clientStateVector: Uint8Array) {
    const entry = await this.load(channelId, path);
    return Y.encodeStateAsUpdate(entry.doc, clientStateVector);
  }

  leave(channelId: string, path: string, socketId: string) {
    const entry = this.docs.get(this.key(channelId, path));
    if (!entry) return;
    entry.members.delete(socketId);
    if (entry.members.size === 0) this.scheduleEvict(channelId, path, entry);
  }

  /** A socket can be in several documents; drop it from all of them. */
  leaveAll(socketId: string) {
    for (const [key, entry] of this.docs) {
      if (!entry.members.delete(socketId)) continue;
      if (entry.members.size === 0) {
        const [channelId, path] = key.split(':');
        this.scheduleEvict(channelId, path, entry);
      }
    }
  }

  private schedulePersist(channelId: string, path: string, entry: LoadedDoc) {
    if (entry.persistTimer) return; // a save is already queued; it will pick up this edit too
    entry.persistTimer = setTimeout(() => {
      entry.persistTimer = null;
      this.persist(channelId, path, entry).catch(err =>
        this.logger.error(`Failed to persist ${channelId}/${path}: ${(err as Error).message}`),
      );
    }, PERSIST_DEBOUNCE_MS);
  }

  private async persist(channelId: string, path: string, entry: LoadedDoc) {
    if (!entry.dirty) return;
    // Snapshot before awaiting: edits can land mid-write, and those must
    // stay flagged dirty rather than being silently marked saved.
    entry.dirty = false;
    const ystate = Buffer.from(Y.encodeStateAsUpdate(entry.doc));
    const content = entry.doc.getText('content').toString();

    // upsert, not update: the row can legitimately be gone by now (the
    // channel was deleted while someone still had the editor open), and
    // an update() would throw on every save attempt for a document that
    // no longer exists.
    await this.prisma.codeDocument.upsert({
      where: { channelId_path: { channelId, path } },
      update: { ystate, content },
      create: { channelId, path, ystate, content },
    });
  }

  private scheduleEvict(channelId: string, path: string, entry: LoadedDoc) {
    if (entry.evictTimer) clearTimeout(entry.evictTimer);
    entry.evictTimer = setTimeout(async () => {
      // Someone may have rejoined while the timer ran.
      if (entry.members.size > 0) return;
      if (entry.persistTimer) { clearTimeout(entry.persistTimer); entry.persistTimer = null; }
      try {
        await this.persist(channelId, path, entry);
      } catch (err) {
        this.logger.error(`Failed final save for ${channelId}/${path}: ${(err as Error).message}`);
        return; // keep it in memory rather than dropping unsaved work
      }
      entry.doc.destroy();
      this.docs.delete(this.key(channelId, path));
    }, EVICT_AFTER_IDLE_MS);
  }

  /** Best-effort flush of everything still dirty when the process stops. */
  async onModuleDestroy() {
    for (const [key, entry] of this.docs) {
      if (entry.persistTimer) clearTimeout(entry.persistTimer);
      if (entry.evictTimer) clearTimeout(entry.evictTimer);
      const [channelId, path] = key.split(':');
      try {
        await this.persist(channelId, path, entry);
      } catch (err) {
        this.logger.error(`Shutdown save failed for ${key}: ${(err as Error).message}`);
      }
    }
  }
}
