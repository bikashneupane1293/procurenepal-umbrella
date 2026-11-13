import { BadRequestException, Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });

    if (existingTenant) {
      throw new ConflictException('Company slug is already taken');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          slug: dto.tenantSlug,
          contactEmail: dto.email,
          contactPhone: dto.phone,
        },
      });

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash: hashedPassword,
          fullName: dto.fullName,
          phone: dto.phone,
          role: 'OWNER',
          tenantId: tenant.id,
          isVerified: true,
        },
      });

      return { tenant, user };
    });

    return this.generateTokens(result.user.id, result.user.email, result.user.role, result.tenant.id);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'PENDING') {
      throw new UnauthorizedException('This account has not been activated yet — use the activation link that was sent to you');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.prisma.loginSession.create({
      data: { tenantId: user.tenantId, userId: user.id },
    });

    return this.generateTokens(user.id, user.email, user.role, user.tenantId);
  }

  /** Closes the most recent open session for this user (best-effort: a closed browser tab leaves it open). */
  async logout(userId: string) {
    const open = await this.prisma.loginSession.findFirst({ where: { userId, logoutAt: null } });
    if (open) await this.prisma.loginSession.update({ where: { id: open.id }, data: { logoutAt: new Date() } });
    return { ok: true };
  }

  // ------------------------------------------------------- activation (Task 5)

  async validateActivation(token: string) {
    const user = await this.prisma.user.findFirst({ where: { activationToken: token } });
    if (!user) throw new BadRequestException('This activation link is not valid. Ask the workspace Owner for a new one.');
    if (user.activationExpires && user.activationExpires < new Date()) {
      throw new BadRequestException('This activation link has expired. Ask the workspace Owner for a new one.');
    }
    return { email: user.email, fullName: user.fullName };
  }

  async activate(token: string, password: string) {
    const user = await this.prisma.user.findFirst({ where: { activationToken: token } });
    if (!user) throw new BadRequestException('This activation link is not valid. Ask the workspace Owner for a new one.');
    if (user.activationExpires && user.activationExpires < new Date()) {
      throw new BadRequestException('This activation link has expired. Ask the workspace Owner for a new one.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        status: 'ACTIVE',
        isVerified: true,
        activationToken: null,
        activationExpires: null,
        lastLoginAt: new Date(),
      },
    });
    await this.prisma.loginSession.create({ data: { tenantId: user.tenantId, userId: user.id } });
    return this.generateTokens(user.id, user.email, user.role, user.tenantId);
  }

  private async generateTokens(userId: string, email: string, role: string, tenantId: string) {
    const payload = { sub: userId, email, role, tenantId };

    return {
      access_token: this.jwtService.sign(payload),
      user: { id: userId, email, role, tenantId },
    };
  }
}
