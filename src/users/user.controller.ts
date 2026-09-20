import { Controller, Get, Patch, Query, Body, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private userService: UserService) {}

  @Get('search')
  search(@Query('q') q: string, @CurrentUser() user: JwtUser) {
    return this.userService.searchUsers(q, user.id);
  }

  @Get('me/settings')
  getSettings(@CurrentUser() user: JwtUser) {
    return this.userService.getSettings(user.id);
  }

  @Patch('me/settings')
  updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() user: JwtUser) {
    return this.userService.updateSettings(user.id, dto);
  }
}
