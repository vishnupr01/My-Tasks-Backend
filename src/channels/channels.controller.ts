import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { GrantChannelAccessDto } from './dto/grant-access.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SaveCodeDocumentDto } from './dto/save-code-document.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private channelsService: ChannelsService) {}

  // ── Channels ──────────────────────────────────────────────────

  @Get('channels')
  listChannels(@CurrentUser() user: JwtUser) {
    return this.channelsService.listChannelsForUser(user.id, user.isAdmin);
  }

  @Post('channels')
  @UseGuards(AdminGuard)
  createChannel(@Body() dto: CreateChannelDto, @CurrentUser() user: JwtUser) {
    return this.channelsService.createChannel(dto, user.id);
  }

  // ── Members ───────────────────────────────────────────────────

  @Get('channels/:id/members')
  listMembers(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.channelsService.listMembers(id, user.id, user.isAdmin);
  }

  // ── Messages ──────────────────────────────────────────────────

  @Get('channels/:id/messages')
  listMessages(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Query('before') before: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.channelsService.listMessages(id, user.id, user.isAdmin, {
      limit: limit ? parseInt(limit, 10) : undefined,
      before,
    });
  }

  @Post('channels/:id/messages')
  sendMessage(@Param('id') id: string, @Body() dto: SendMessageDto, @CurrentUser() user: JwtUser) {
    return this.channelsService.sendMessage(id, user.id, user.isAdmin, dto);
  }

  @Post('channels/:id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.channelsService.markChannelRead(id, user.id, user.isAdmin);
  }

  // ── Code documents ────────────────────────────────────────────

  @Get('channels/:id/code')
  getCodeDocument(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.channelsService.getCodeDocument(id, user.id, user.isAdmin);
  }

  @Put('channels/:id/code')
  saveCodeDocument(@Param('id') id: string, @Body() dto: SaveCodeDocumentDto, @CurrentUser() user: JwtUser) {
    return this.channelsService.saveCodeDocument(id, user.id, user.isAdmin, dto);
  }

  // ── Access grants ─────────────────────────────────────────────

  @Get('channels/:id/access')
  @UseGuards(AdminGuard)
  listAccess(@Param('id') id: string) {
    return this.channelsService.listAccess(id);
  }

  @Post('channels/:id/access')
  @UseGuards(AdminGuard)
  grantAccess(@Param('id') id: string, @Body() dto: GrantChannelAccessDto) {
    return this.channelsService.grantAccess(id, dto);
  }

  @Delete('channels/:id/access/:accessId')
  @UseGuards(AdminGuard)
  revokeAccess(@Param('id') id: string, @Param('accessId') accessId: string) {
    return this.channelsService.revokeAccess(id, accessId);
  }

  // ── Roles ─────────────────────────────────────────────────────

  @Get('roles')
  @UseGuards(AdminGuard)
  listRoles() {
    return this.channelsService.listRoles();
  }

  @Post('roles')
  @UseGuards(AdminGuard)
  createRole(@Body() dto: CreateRoleDto) {
    return this.channelsService.createRole(dto);
  }

  @Post('roles/:id/users')
  @UseGuards(AdminGuard)
  assignRole(@Param('id') id: string, @Body('userId') userId: string) {
    return this.channelsService.assignRole(id, userId);
  }

  @Delete('roles/:id/users/:userId')
  @UseGuards(AdminGuard)
  removeRole(@Param('id') id: string, @Param('userId') userId: string) {
    return this.channelsService.removeRole(id, userId);
  }
}
