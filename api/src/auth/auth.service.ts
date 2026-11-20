import { BadRequestException, Injectable, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { StaffService } from '../staff/staff.service';
import { GoogleVerifier } from './google-verifier';
import { MailService } from '../mail/mail.service';
import { normalizeCode } from '../common/codes';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private staff: StaffService,
    private googleVerifier: GoogleVerifier,
    private mail: MailService,
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

  // ------------------------------------------------------- Task 12: Google + Org ID sign-up

  /** What the sign-in / sign-up pages need to know about this server. */
  config() {
    return { googleClientId: this.googleVerifier.clientId(), emailEnabled: this.mail.enabled() };
  }

  /**
   * Sign in (or sign up) with Google. A new person starts in their own free workspace; with an
   * Org ID they join that organization at once if it already invited this exact Google-verified
   * email, otherwise the Owner gets a join request. Joining never blocks the sign-in itself.
   */
  async googleLogin(credential: string, orgCode?: string) {
    const g = await this.googleVerifier.verify(credential);
    if (!g.emailVerified) throw new UnauthorizedException('Your Google email address is not verified');
    let user: any = (await this.prisma.user.findUnique({ where: { googleId: g.sub } as any })) ?? (await this.prisma.user.findUnique({ where: { email: g.email } }));
    let created = false;
    if (user) {
      if (user.googleId && user.googleId !== g.sub) throw new UnauthorizedException('This email is linked to a different Google account');
      if (!user.isActive) throw new UnauthorizedException('Account is deactivated');
      const data: any = { lastLoginAt: new Date() };
      if (!user.googleId) data.googleId = g.sub;
      // Google has proven they own the email, so an unused activation link isn't needed any more.
      if (user.status === 'PENDING') Object.assign(data, { status: 'ACTIVE', isVerified: true, activationToken: null, activationExpires: null });
      user = await this.prisma.user.update({ where: { id: user.id }, data });
    } else {
      user = await this.staff.createPersonalUser({ email: g.email, fullName: g.name, googleId: g.sub, verified: true });
      created = true;
    }
    await this.staff.ensureUserCode(user.id);
    let join: any = null;
    if (orgCode && normalizeCode(orgCode)) {
      try {
        join = await this.staff.requestToJoin(user.id, orgCode);
      } catch (e: any) {
        join = { result: 'ERROR', message: e?.response?.message ?? e?.message ?? 'Could not join' };
      }
    }
    user = await this.prisma.user.findUnique({ where: { id: user.id } });
    await this.prisma.loginSession.create({ data: { tenantId: user.tenantId, userId: user.id } });
    return { ...(await this.generateTokens(user.id, user.email, user.role, user.tenantId)), created, join };
  }

  /**
   * Sign up with an Org ID and a password. The email isn't proven here, so the person always
   * starts in their own free workspace with a join request the Owner approves (never an
   * automatic join, even if that email was invited — that needs Google's verified email).
   */
  async joinWithPassword(dto: { orgCode: string; fullName: string; email: string; password: string; phone?: string }) {
    const code = normalizeCode(dto.orgCode);
    const tenant: any = await this.prisma.tenant.findUnique({ where: { orgCode: code } as any });
    if (!tenant) throw new NotFoundException(`No organization has the Org ID ${code} — check it with your office`);
    const user: any = await this.staff.createPersonalUser({ email: dto.email, fullName: dto.fullName, phone: dto.phone, password: dto.password, verified: false });
    await this.staff.ensureUserCode(user.id);
    const join = await this.staff.requestToJoin(user.id, code, false);
    await this.prisma.loginSession.create({ data: { tenantId: user.tenantId, userId: user.id } });
    return { ...(await this.generateTokens(user.id, user.email, user.role, user.tenantId)), created: true, join };
  }

  private async generateTokens(userId: string, email: string, role: string, tenantId: string) {
    const payload = { sub: userId, email, role, tenantId };

    return {
      access_token: this.jwtService.sign(payload),
      user: { id: userId, email, role, tenantId },
    };
  }
}
