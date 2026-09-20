import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { userCanAccessChannel } from '../common/access-checks';
import { ChatGateway } from '../chat/chat.gateway';
import { CreateChannelDto } from './dto/create-channel.dto';
import { GrantChannelAccessDto } from './dto/grant-access.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SaveCodeDocumentDto } from './dto/save-code-document.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  // ── Access resolution ────────────────────────────────────────

  async userCanAccessChannel(userId: string, isAdmin: boolean, channelId: string): Promise<boolean> {
    return userCanAccessChannel(this.prisma, userId, isAdmin, channelId);
  }

  private async assertAccess(userId: string, isAdmin: boolean, channelId: string) {
    const allowed = await this.userCanAccessChannel(userId, isAdmin, channelId);
    if (!allowed) throw new ForbiddenException('You do not have access to this channel');
  }

  // ── Channels ──────────────────────────────────────────────────

  async listChannelsForUser(userId: string, isAdmin: boolean) {
    if (isAdmin) {
      return this.prisma.channel.findMany({ orderBy: { createdAt: 'asc' } });
    }
    return this.prisma.channel.findMany({
      where: {
        OR: [
          { isPrivate: false },
          { access: { some: { userId } } },
          { access: { some: { role: { users: { some: { userId } } } } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createChannel(dto: CreateChannelDto, creatorId: string) {
    const existing = await this.prisma.channel.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A channel with this name already exists');

    return this.prisma.channel.create({
      data: {
        name: dto.name,
        description: dto.description,
        isPrivate: dto.isPrivate ?? false,
        kind: dto.kind ?? 'TEXT',
        createdById: creatorId,
      },
    });
  }

  // ── Code documents ────────────────────────────────────────────

  // The editor surface of a CODE channel. Access is the ordinary channel
  // check -- a code channel is just a channel, so whoever can read its
  // messages can read (and edit) its document. No separate permission
  // model, deliberately.
  private async assertCodeChannel(channelId: string, userId: string, isAdmin: boolean) {
    await this.assertAccess(userId, isAdmin, channelId);
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.kind !== 'CODE') throw new BadRequestException('This channel does not have a code editor');
  }

  // Created lazily on first open rather than at channel-creation time: one
  // less thing to keep in sync if document defaults change, and channels
  // created before this feature existed still work.
  async getCodeDocument(channelId: string, userId: string, isAdmin: boolean, path = 'main') {
    await this.assertCodeChannel(channelId, userId, isAdmin);
    return this.prisma.codeDocument.upsert({
      where: { channelId_path: { channelId, path } },
      update: {},
      create: { channelId, path },
    });
  }

  async saveCodeDocument(
    channelId: string,
    userId: string,
    isAdmin: boolean,
    dto: SaveCodeDocumentDto,
    path = 'main',
  ) {
    await this.assertCodeChannel(channelId, userId, isAdmin);
    // Only the fields actually sent are written. Passing `content:
    // undefined` to Prisma leaves the column alone, which is what keeps a
    // language change from wiping text the CRDT is responsible for.
    return this.prisma.codeDocument.upsert({
      where: { channelId_path: { channelId, path } },
      update: { content: dto.content, language: dto.language, updatedById: userId },
      create: { channelId, path, content: dto.content ?? '', language: dto.language, updatedById: userId },
    });
  }

  // ── Access grants ─────────────────────────────────────────────

  async grantAccess(channelId: string, dto: GrantChannelAccessDto) {
    if ((dto.userId && dto.roleId) || (!dto.userId && !dto.roleId)) {
      throw new BadRequestException('Provide exactly one of userId or roleId');
    }

    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');

    return this.prisma.channelAccess.create({
      data: { channelId, userId: dto.userId, roleId: dto.roleId },
      include: {
        user: { select: { id: true, username: true, email: true } },
        role: { select: { id: true, name: true } },
      },
    });
  }

  async revokeAccess(channelId: string, accessId: string) {
    const grant = await this.prisma.channelAccess.findUnique({ where: { id: accessId } });
    if (!grant || grant.channelId !== channelId) throw new NotFoundException('Access grant not found');
    await this.prisma.channelAccess.delete({ where: { id: accessId } });
    return { message: 'Access revoked' };
  }

  async listAccess(channelId: string) {
    return this.prisma.channelAccess.findMany({
      where: { channelId },
      include: {
        user: { select: { id: true, username: true, email: true } },
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Members ───────────────────────────────────────────────────

  // "Members" = everyone who can currently see this channel, same rule the
  // access check itself uses: for a public channel that's every active
  // user; for a private one it's whoever holds an explicit grant (directly
  // or via a role) plus admins (who bypass private-channel checks entirely).
  async listMembers(channelId: string, userId: string, isAdmin: boolean) {
    await this.assertAccess(userId, isAdmin, channelId);

    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');

    const memberSelect = { id: true, username: true, name: true, isAdmin: true, isActive: true } as const;

    if (!channel.isPrivate) {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
        select: memberSelect,
        orderBy: { username: 'asc' },
      });
      return users.map(({ isActive: _isActive, ...u }) => u);
    }

    const [admins, grants] = await Promise.all([
      this.prisma.user.findMany({ where: { isAdmin: true, isActive: true }, select: memberSelect }),
      this.prisma.channelAccess.findMany({
        where: { channelId },
        include: {
          user: { select: memberSelect },
          role: { include: { users: { include: { user: { select: memberSelect } } } } },
        },
      }),
    ]);

    const members = new Map<string, { id: string; username: string; name: string | null; isAdmin: boolean; isActive: boolean }>();
    admins.forEach(a => members.set(a.id, a));
    grants.forEach(g => {
      if (g.user?.isActive) members.set(g.user.id, g.user);
      g.role?.users.forEach(ur => { if (ur.user.isActive) members.set(ur.user.id, ur.user); });
    });

    return [...members.values()]
      .sort((a, b) => a.username.localeCompare(b.username))
      .map(({ isActive: _isActive, ...u }) => u);
  }

  // ── Messages ──────────────────────────────────────────────────

  // Cursor-paginated, newest page first: fetch limit+1 ordered newest-first
  // so the "+1" tells us whether an older page exists, then reverse to
  // ascending order for rendering. `before` pages backwards from a message's
  // createdAt (the oldest one currently loaded on the client).
  async listMessages(channelId: string, userId: string, isAdmin: boolean, opts: { limit?: number; before?: string } = {}) {
    await this.assertAccess(userId, isAdmin, channelId);
    const limit = Math.min(Math.max(opts.limit ?? 15, 1), 100);

    const page = await this.prisma.message.findMany({
      where: {
        channelId,
        ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
      },
      include: { author: { select: { id: true, username: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = page.length > limit;
    return { messages: page.slice(0, limit).reverse(), hasMore };
  }

  async sendMessage(channelId: string, userId: string, isAdmin: boolean, dto: SendMessageDto) {
    await this.assertAccess(userId, isAdmin, channelId);
    if (!dto.content && !dto.attachmentUrl) {
      throw new BadRequestException('Message must have text or an attachment');
    }
    const message = await this.prisma.message.create({
      data: {
        channelId,
        authorId: userId,
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
        attachmentType: dto.attachmentType,
        attachmentName: dto.attachmentName,
        attachmentDuration: dto.attachmentDuration,
      },
      include: { author: { select: { id: true, username: true, name: true } } },
    });
    this.chatGateway.emitChannelMessage(channelId, message);
    return message;
  }

  async markChannelRead(channelId: string, userId: string, isAdmin: boolean) {
    await this.assertAccess(userId, isAdmin, channelId);
    await this.prisma.channelRead.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: { lastReadAt: new Date() },
      create: { userId, channelId },
    });
    return { ok: true };
  }

  // ── Roles ─────────────────────────────────────────────────────

  async createRole(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A role with this name already exists');
    return this.prisma.role.create({ data: { name: dto.name } });
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: { users: { include: { user: { select: { id: true, username: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async assignRole(roleId: string, userId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId } },
    });
    if (existing) throw new ConflictException('User already has this role');

    return this.prisma.userRole.create({ data: { userId, roleId } });
  }

  async removeRole(roleId: string, userId: string) {
    await this.prisma.userRole.delete({ where: { userId_roleId: { userId, roleId } } });
    return { message: 'Role removed' };
  }
}
