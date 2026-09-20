import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { areFriends, dmConversationKey } from '../common/access-checks';
import { ChatGateway } from '../chat/chat.gateway';
import { SendDirectMessageDto } from './dto/send-message.dto';

const userSelect = { id: true, username: true, name: true } as const;

@Injectable()
export class FriendsService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  // ── Requests ──────────────────────────────────────────────────

  async sendRequest(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException("You can't send a friend request to yourself");
    }

    // A row already exists between these two people in either direction?
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });

    if (existing?.status === 'ACCEPTED') throw new ConflictException('You are already friends');
    if (existing?.status === 'PENDING') throw new ConflictException('A friend request is already pending between you two');

    let request;
    if (existing) {
      // Was DECLINED -- reuse the row rather than insert a new one, since the
      // unique constraint is keyed on this exact (senderId, receiverId) pair
      // and re-pointing it to the current direction keeps that intact.
      request = await this.prisma.friendRequest.update({
        where: { id: existing.id },
        data: { senderId, receiverId, status: 'PENDING' },
      });
    } else {
      request = await this.prisma.friendRequest.create({
        data: { senderId, receiverId, status: 'PENDING' },
      });
    }

    await this.prisma.notification.create({
      data: { senderId, receiverId, type: 'FRIEND_REQUEST' },
    });

    return request;
  }

  async respondToRequest(requestId: string, receiverId: string, status: 'ACCEPTED' | 'DECLINED') {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.receiverId !== receiverId) throw new ForbiddenException('This request is not addressed to you');
    if (request.status !== 'PENDING') throw new ConflictException('This request has already been responded to');

    const updated = await this.prisma.friendRequest.update({ where: { id: requestId }, data: { status } });

    if (status === 'ACCEPTED') {
      await this.prisma.notification.create({
        data: { senderId: receiverId, receiverId: request.senderId, type: 'FRIEND_ACCEPTED' },
      });
    }

    return updated;
  }

  async cancelRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.senderId !== userId) throw new ForbiddenException('You can only cancel requests you sent');
    if (request.status !== 'PENDING') throw new ConflictException('Only pending requests can be cancelled');
    await this.prisma.friendRequest.delete({ where: { id: requestId } });
    return { message: 'Request cancelled' };
  }

  async listIncoming(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: { sender: { select: userSelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listOutgoing(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: { senderId: userId, status: 'PENDING' },
      include: { receiver: { select: userSelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Friends ───────────────────────────────────────────────────

  async listFriends(userId: string) {
    const rows = await this.prisma.friendRequest.findMany({
      where: { status: 'ACCEPTED', OR: [{ senderId: userId }, { receiverId: userId }] },
      include: { sender: { select: userSelect }, receiver: { select: userSelect } },
    });
    return rows.map(r => (r.senderId === userId ? r.receiver : r.sender));
  }

  async removeFriend(userId: string, friendId: string) {
    const row = await this.prisma.friendRequest.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: userId, receiverId: friendId },
          { senderId: friendId, receiverId: userId },
        ],
      },
    });
    if (!row) throw new NotFoundException('You are not friends with this user');
    await this.prisma.friendRequest.delete({ where: { id: row.id } });
    return { message: 'Friend removed' };
  }

  // ── Direct messages ───────────────────────────────────────────

  private async assertFriends(userId: string, otherId: string) {
    const friends = await areFriends(this.prisma, userId, otherId);
    if (!friends) throw new ForbiddenException('You can only message friends');
  }

  // Same cursor-pagination shape as ChannelsService.listMessages -- newest
  // page first (limit+1 to detect an older page), reversed to ascending for
  // rendering. `before` pages backwards from the oldest message currently
  // loaded on the client.
  async getMessages(userId: string, otherId: string, opts: { limit?: number; before?: string } = {}) {
    await this.assertFriends(userId, otherId);
    const limit = Math.min(Math.max(opts.limit ?? 15, 1), 100);

    const conversation = await this.prisma.directConversation.findUnique({
      where: { userAId_userBId: dmConversationKey(userId, otherId) },
    });
    if (!conversation) return { messages: [], hasMore: false };

    const page = await this.prisma.directMessage.findMany({
      where: {
        conversationId: conversation.id,
        ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
      },
      include: { sender: { select: userSelect } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = page.length > limit;
    return { messages: page.slice(0, limit).reverse(), hasMore };
  }

  async sendMessage(userId: string, otherId: string, dto: SendDirectMessageDto) {
    await this.assertFriends(userId, otherId);
    if (!dto.content && !dto.attachmentUrl) {
      throw new BadRequestException('Message must have text or an attachment');
    }
    const key = dmConversationKey(userId, otherId);
    const conversation = await this.prisma.directConversation.upsert({
      where: { userAId_userBId: key },
      update: {},
      create: key,
    });

    const message = await this.prisma.directMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: userId,
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
        attachmentType: dto.attachmentType,
        attachmentName: dto.attachmentName,
        attachmentDuration: dto.attachmentDuration,
      },
      include: { sender: { select: userSelect } },
    });
    this.chatGateway.emitDirectMessage(key.userAId, key.userBId, message);
    return message;
  }

  async markDmRead(userId: string, otherId: string) {
    await this.assertFriends(userId, otherId);
    await this.prisma.dmRead.upsert({
      where: { userId_otherUserId: { userId, otherUserId: otherId } },
      update: { lastReadAt: new Date() },
      create: { userId, otherUserId: otherId },
    });
    return { ok: true };
  }
}
