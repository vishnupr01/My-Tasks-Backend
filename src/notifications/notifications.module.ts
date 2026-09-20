import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ChannelsModule } from '../channels/channels.module';
import { FriendsModule } from '../friends/friends.module';

@Module({
  imports: [ChannelsModule, FriendsModule],
  providers: [NotificationsService],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
