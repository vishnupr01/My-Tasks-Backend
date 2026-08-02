import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const ACCESS_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async checkUsernameAvailable(username: string) {
    if (!username || !/^[a-z0-9._]{3,20}$/.test(username)) {
      return { available: false };
    }
    const existing = await this.prisma.user.findUnique({ where: { username } });
    return { available: !existing };
  }

  async register(dto: RegisterDto) {
    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      if (dto.inviteCode) {
        const claimed = await tx.inviteCode.updateMany({
          where: { code: dto.inviteCode, usedById: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new ForbiddenException('Invalid or already-used invite code');
        }
      } else {
        const approved = await tx.accessRequest.findFirst({
          where: { email: dto.email, status: 'APPROVED' },
        });
        if (!approved) {
          throw new ForbiddenException(
            'This email is not approved for registration. Request access or use an invite code.',
          );
        }
      }

      const existingEmail = await tx.user.findUnique({ where: { email: dto.email } });
      if (existingEmail) throw new ConflictException('Email already in use');

      const existingUsername = await tx.user.findUnique({ where: { username: dto.username } });
      if (existingUsername) throw new ConflictException('Username already in use');

      const created = await tx.user.create({
        data: { email: dto.email, username: dto.username, password: hashed, name: dto.name },
        select: { id: true, email: true, username: true, name: true, isAdmin: true, createdAt: true },
      });

      if (dto.inviteCode) {
        await tx.inviteCode.update({
          where: { code: dto.inviteCode },
          data: { usedById: created.id },
        });
      }

      return created;
    });

    const token = this.jwtService.sign({ sub: user.id, email: user.email });
    return { user, token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (!user.isActive) throw new UnauthorizedException('This account has been deactivated');

    const token = this.jwtService.sign({ sub: user.id, email: user.email });
    const { password: _, ...safeUser } = user;
    return { user: safeUser, token };
  }

  // ── Access requests (email whitelist queue) ─────────────────────

  async createAccessRequest(email: string) {
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new ConflictException('An account with this email already exists');

    const recent = await this.prisma.accessRequest.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const elapsed = Date.now() - recent.createdAt.getTime();
      if (elapsed < ACCESS_REQUEST_COOLDOWN_MS) {
        const hoursLeft = Math.ceil((ACCESS_REQUEST_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
        throw new ForbiddenException(`You already requested access. Try again in ~${hoursLeft}h.`);
      }
    }

    return this.prisma.accessRequest.create({ data: { email } });
  }

  async listAccessRequests() {
    return this.prisma.accessRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { decidedBy: { select: { id: true, username: true } } },
    });
  }

  async decideAccessRequest(id: string, status: 'APPROVED' | 'DECLINED', adminId: string) {
    const request = await this.prisma.accessRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') throw new ConflictException('Request already decided');

    return this.prisma.accessRequest.update({
      where: { id },
      data: { status, decidedAt: new Date(), decidedById: adminId },
    });
  }

  // ── Invite codes (fast-lane, admin hands out directly) ──────────

  async createInviteCode(adminId: string) {
    const code = randomBytes(6).toString('hex');
    return this.prisma.inviteCode.create({ data: { code, createdById: adminId } });
  }

  async listInviteCodes() {
    return this.prisma.inviteCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: { usedBy: { select: { id: true, username: true, email: true } } },
    });
  }

  // ── Membership control ───────────────────────────────────────────

  async listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, username: true, email: true, isAdmin: true, isActive: true, createdAt: true },
    });
  }

  async setUserActive(targetUserId: string, isActive: boolean, adminId: string) {
    if (targetUserId === adminId && !isActive) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { isActive },
      select: { id: true, username: true, email: true, isActive: true },
    });
  }
}
