import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { UserModule } from './users/user.module';
import { ChannelsModule } from './channels/channels.module';
import { RoadmapsModule } from './roadmaps/roadmaps.module';
import { FriendsModule } from './friends/friends.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UploadsModule } from './uploads/uploads.module';
import { CodeModule } from './code/code.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, TasksModule, UserModule, ChannelsModule, RoadmapsModule, FriendsModule, NotificationsModule, UploadsModule, CodeModule],
})
export class AppModule {}
