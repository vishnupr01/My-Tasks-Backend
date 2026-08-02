import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { DecideAccessRequestDto } from './dto/decide-access-request.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { CurrentUser, JwtUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('check-username')
  checkUsername(@Query('username') username: string) {
    return this.authService.checkUsernameAvailable(username);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ── Access requests ──────────────────────────────────────────

  @Post('access-requests')
  requestAccess(@Body() dto: CreateAccessRequestDto) {
    return this.authService.createAccessRequest(dto.email);
  }

  @Get('access-requests')
  @UseGuards(JwtAuthGuard, AdminGuard)
  listAccessRequests() {
    return this.authService.listAccessRequests();
  }

  @Patch('access-requests/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  decideAccessRequest(
    @Param('id') id: string,
    @Body() dto: DecideAccessRequestDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.authService.decideAccessRequest(id, dto.status, user.id);
  }

  // ── Invite codes ─────────────────────────────────────────────

  @Post('invite-codes')
  @UseGuards(JwtAuthGuard, AdminGuard)
  createInviteCode(@CurrentUser() user: JwtUser) {
    return this.authService.createInviteCode(user.id);
  }

  @Get('invite-codes')
  @UseGuards(JwtAuthGuard, AdminGuard)
  listInviteCodes() {
    return this.authService.listInviteCodes();
  }

  // ── Membership control ───────────────────────────────────────

  @Get('users')
  @UseGuards(JwtAuthGuard, AdminGuard)
  listUsers() {
    return this.authService.listUsers();
  }

  @Patch('users/:id/active')
  @UseGuards(JwtAuthGuard, AdminGuard)
  setUserActive(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @CurrentUser() user: JwtUser,
  ) {
    return this.authService.setUserActive(id, isActive, user.id);
  }
}
