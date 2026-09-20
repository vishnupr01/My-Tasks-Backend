import { PrismaService } from '../prisma/prisma.service';

// Shared between the REST layer (ChannelsService, FriendsService) and the
// WebSocket gateway, so "can this user see this channel / DM this person"
// is defined exactly once. Two copies of an access rule is how they quietly
// drift apart -- one gets updated, the other doesn't.

export async function userCanAccessChannel(
  prisma: PrismaService,
  userId: string,
  isAdmin: boolean,
  channelId: string,
): Promise<boolean> {
  if (isAdmin) return true;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { isPrivate: true },
  });
  if (!channel) return false;
  if (!channel.isPrivate) return true;

  const grant = await prisma.channelAccess.findFirst({
    where: {
      channelId,
      OR: [{ userId }, { role: { users: { some: { userId } } } }],
    },
  });
  return !!grant;
}

export async function areFriends(prisma: PrismaService, userId: string, otherId: string): Promise<boolean> {
  const row = await prisma.friendRequest.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { senderId: userId, receiverId: otherId },
        { senderId: otherId, receiverId: userId },
      ],
    },
  });
  return !!row;
}

// Canonical room name for a DM pair -- same regardless of who's asking, so
// both participants land in the same Socket.IO room.
export function dmRoomName(userId: string, otherId: string): string {
  return `dm:${[userId, otherId].sort().join(':')}`;
}

// Same canonicalization, but shaped for the DirectConversation table's
// userAId/userBId unique key -- shared so FriendsService and
// NotificationsService can never disagree on which row a pair maps to.
export function dmConversationKey(userId: string, otherId: string): { userAId: string; userBId: string } {
  const [userAId, userBId] = [userId, otherId].sort();
  return { userAId, userBId };
}
