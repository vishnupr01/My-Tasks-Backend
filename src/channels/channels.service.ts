import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { GrantChannelAccessDto } from './dto/grant-access.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChannelsService {
  constructor(private prisma: PrismaService) {}

  // ── Access resolution ────────────────────────────────────────

  async userCanAccessChannel(userId: string, isAdmin: boolean, channelId: string): Promise<boolean> {
    if (isAdmin) return true;

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { isPrivate: true },
    });
    if (!channel) return false;
    if (!channel.isPrivate) return true;

    const grant = await this.prisma.channelAccess.findFirst({
      where: {
        channelId,
        OR: [{ userId }, { role: { users: { some: { userId } } } }],
      },
    });
    return !!grant;
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
        createdById: creatorId,
      },
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

  // ── Messages ──────────────────────────────────────────────────

  async listMessages(channelId: string, userId: string, isAdmin: boolean) {
    await this.assertAccess(userId, isAdmin, channelId);
    return this.prisma.message.findMany({
      where: { channelId },
      include: { author: { select: { id: true, username: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async sendMessage(channelId: string, userId: string, isAdmin: boolean, dto: SendMessageDto) {
    await this.assertAccess(userId, isAdmin, channelId);
    return this.prisma.message.create({
      data: { channelId, authorId: userId, content: dto.content },
      include: { author: { select: { id: true, username: true, name: true } } },
    });
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
