import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { FriendsService } from './friends.service';
import { SendRequestDto } from './dto/send-request.dto';
import { RespondRequestDto } from './dto/respond-request.dto';
import { SendDirectMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  // ── Requests (static routes declared before the :userId param routes below) ──

  @Post('requests')
  sendRequest(@Body() dto: SendRequestDto, @CurrentUser() user: JwtUser) {
    return this.friendsService.sendRequest(user.id, dto.receiverId);
  }

  @Get('requests/incoming')
  listIncoming(@CurrentUser() user: JwtUser) {
    return this.friendsService.listIncoming(user.id);
  }

  @Get('requests/outgoing')
  listOutgoing(@CurrentUser() user: JwtUser) {
    return this.friendsService.listOutgoing(user.id);
  }

  @Patch('requests/:id')
  respond(@Param('id') id: string, @Body() dto: RespondRequestDto, @CurrentUser() user: JwtUser) {
    return this.friendsService.respondToRequest(id, user.id, dto.status);
  }

  @Delete('requests/:id')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.friendsService.cancelRequest(id, user.id);
  }

  // ── Friends list ──────────────────────────────────────────────

  @Get()
  listFriends(@CurrentUser() user: JwtUser) {
    return this.friendsService.listFriends(user.id);
  }

  @Delete(':userId')
  removeFriend(@Param('userId') userId: string, @CurrentUser() user: JwtUser) {
    return this.friendsService.removeFriend(user.id, userId);
  }

  // ── Direct messages ───────────────────────────────────────────

  @Get(':userId/messages')
  getMessages(
    @Param('userId') userId: string,
    @Query('limit') limit: string | undefined,
    @Query('before') before: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.friendsService.getMessages(user.id, userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      before,
    });
  }

  @Post(':userId/messages')
  sendMessage(@Param('userId') userId: string, @Body() dto: SendDirectMessageDto, @CurrentUser() user: JwtUser) {
    return this.friendsService.sendMessage(user.id, userId, dto);
  }

  @Post(':userId/read')
  markRead(@Param('userId') userId: string, @CurrentUser() user: JwtUser) {
    return this.friendsService.markDmRead(user.id, userId);
  }
}
