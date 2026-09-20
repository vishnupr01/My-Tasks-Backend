import { Controller, Get, UseGuards } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatGateway: ChatGateway) {}

  // Initial snapshot for a page that just mounted -- live changes after this
  // arrive over the socket as 'presence:online' / 'presence:offline'.
  @Get('online')
  listOnline(): string[] {
    return this.chatGateway.getOnlineUserIds();
  }
}
