import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dmConversationKey } from '../common/access-checks';
import { ChannelsService } from '../channels/channels.service';
import { FriendsService } from '../friends/friends.service';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
    private friendsService: FriendsService,
  ) {}

  // One summary for the whole sidebar: per-channel and per-friend unread
  // counts, plus the pending-friend-request count. No row in ChannelRead/
  // DmRead means "never opened" -- unread then falls back to every message
  // not authored by this user, same as a fresh Discord channel showing
  // everything as unread until you first open it.
  async getSummary(userId: string, isAdmin: boolean) {
    const [channels, friends, friendRequests, channelReads, dmReads] = await Promise.all([
      this.channelsService.listChannelsForUser(userId, isAdmin),
      this.friendsService.listFriends(userId),
      this.prisma.friendRequest.count({ where: { receiverId: userId, status: 'PENDING' } }),
      this.prisma.channelRead.findMany({ where: { userId } }),
      this.prisma.dmRead.findMany({ where: { userId } }),
    ]);

    const channelReadMap = new Map(channelReads.map(r => [r.channelId, r.lastReadAt]));
    const dmReadMap = new Map(dmReads.map(r => [r.otherUserId, r.lastReadAt]));

    const channelCounts = await Promise.all(
      channels.map(async ch => {
        const lastReadAt = channelReadMap.get(ch.id);
        const count = await this.prisma.message.count({
          where: {
            channelId: ch.id,
            authorId: { not: userId },
            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
          },
        });
        return [ch.id, count] as const;
      }),
    );

    const dmCounts = await Promise.all(
      friends.map(async f => {
        const lastReadAt = dmReadMap.get(f.id);
        const conversation = await this.prisma.directConversation.findUnique({
          where: { userAId_userBId: dmConversationKey(userId, f.id) },
        });
        if (!conversation) return [f.id, 0] as const;

        const count = await this.prisma.directMessage.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
          },
        });
        return [f.id, count] as const;
      }),
    );

    return {
      channels: Object.fromEntries(channelCounts.filter(([, count]) => count > 0)),
      dms: Object.fromEntries(dmCounts.filter(([, count]) => count > 0)),
      friendRequests,
    };
  }
}
