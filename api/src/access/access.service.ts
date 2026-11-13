import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ROLES,
  ALL_ACCESS_ROLES,
  ASSIGNABLE_ROLES,
  LOGIN_VIEW_ROLES,
  MODULES,
  MODULE_KEYS,
  USER_VIEW_ROLES,
  flagKeyOf,
  itemFlagKeyOf,
} from './module-registry';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const PUBLIC_USER = {
  id: true, email: true, fullName: true, phone: true, role: true, isActive: true,
  modules: true, lastLoginAt: true, createdAt: true, status: true, customTitle: true,
} as const;

const ACTIVATION_DAYS = 7;
const ITEM_KEY = /^[a-z0-9.\-]{1,60}$/i;

@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService) {}

  // ------------------------------------------------------- workspace modules

  /** { companies: true, bolpatra: true, … } — a module with no saved setting is ON. */
  async tenantModules(tenantId: string): Promise<Record<string, boolean>> {
    const flags = await this.prisma.tenantFeatureFlag.findMany({
      where: { tenantId, flagKey: { in: MODULE_KEYS.map(flagKeyOf) } },
    });
    const out: Record<string, boolean> = {};
    for (const m of MODULES) {
      const f = flags.find((x) => x.flagKey === flagKeyOf(m.key));
      out[m.key] = m.core ? true : f ? f.enabled : true;
    }
    return out;
  }

  async setTenantModules(tenantId: string, role: string, changes: Record<string, boolean>) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can switch modules on or off');
    for (const [key, enabled] of Object.entries(changes)) {
      const def = MODULES.find((m) => m.key === key);
      if (!def) throw new BadRequestException(`Unknown module "${key}"`);
      if (def.core && !enabled) throw new BadRequestException(`${def.name} is a core module and cannot be switched off`);
      if (typeof enabled !== 'boolean') throw new BadRequestException(`Value for "${key}" must be true or false`);
    }
    for (const [key, enabled] of Object.entries(changes)) {
      await this.prisma.tenantFeatureFlag.upsert({
        where: { tenantId_flagKey: { tenantId, flagKey: flagKeyOf(key) } },
        create: { tenantId, flagKey: flagKeyOf(key), enabled, enabledAt: enabled ? new Date() : null },
        update: { enabled, enabledAt: enabled ? new Date() : null },
      });
    }
    return this.tenantModules(tenantId);
  }

  // ------------------------------------------------------- sidebar items (Task 5)
  // Item IDs come from the web app's menu (core/modules.ts). The backend does not
  // repeat that list — any id that looks like one ("project.milestones") is accepted —
  // so this is enforced in the sidebar; a direct link to a disabled item still opens
  // until a second check is added to the ERP controller (noted in PROGRESS.md).

  /** { 'project.milestones': false, … } — only overrides are returned; a missing id is ON. */
  async tenantItems(tenantId: string): Promise<Record<string, boolean>> {
    const flags = await this.prisma.tenantFeatureFlag.findMany({ where: { tenantId, flagKey: { startsWith: 'item:' } } });
    const out: Record<string, boolean> = {};
    for (const f of flags) out[f.flagKey.slice('item:'.length)] = f.enabled;
    return out;
  }

  /** false only when the Owner explicitly switched this one sidebar item off. */
  async itemEnabled(tenantId: string, itemId: string): Promise<boolean> {
    const f = await this.prisma.tenantFeatureFlag.findUnique({ where: { tenantId_flagKey: { tenantId, flagKey: itemFlagKeyOf(itemId) } } });
    return f ? f.enabled : true;
  }

  async setTenantItems(tenantId: string, role: string, changes: Record<string, boolean>) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can switch sidebar items on or off');
    for (const [id, enabled] of Object.entries(changes)) {
      if (!ITEM_KEY.test(id)) throw new BadRequestException(`"${id}" is not a valid item id`);
      if (typeof enabled !== 'boolean') throw new BadRequestException(`Value for "${id}" must be true or false`);
    }
    for (const [id, enabled] of Object.entries(changes)) {
      await this.prisma.tenantFeatureFlag.upsert({
        where: { tenantId_flagKey: { tenantId, flagKey: itemFlagKeyOf(id) } },
        create: { tenantId, flagKey: itemFlagKeyOf(id), enabled, enabledAt: enabled ? new Date() : null },
        update: { enabled, enabledAt: enabled ? new Date() : null },
      });
    }
    return this.tenantItems(tenantId);
  }

  // ------------------------------------------------------- the signed-in user

  /** Modules this user may open = active in the workspace AND allowed for the user. */
  async effectiveModules(tenantId: string, userId: string, role: string): Promise<string[]> {
    const tm = await this.tenantModules(tenantId);
    const active = MODULE_KEYS.filter((k) => tm[k]);
    if (ALL_ACCESS_ROLES.includes(role)) return active;
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { modules: true } });
    const own: string[] = user?.modules ?? [];
    if (!own.length) return active; // no limit set → every active module
    return active.filter((k) => MODULES.find((m) => m.key === k)?.core || own.includes(k));
  }

  async me(tenantId: string, userId: string, role: string) {
    return {
      role,
      canManage: ADMIN_ROLES.includes(role),
      canViewLogins: LOGIN_VIEW_ROLES.includes(role),
      modules: await this.effectiveModules(tenantId, userId, role),
      workspaceModules: await this.tenantModules(tenantId),
      itemFlags: await this.tenantItems(tenantId),
      registry: MODULES,
    };
  }

  // ------------------------------------------------------- user setup

  async listUsers(tenantId: string, role: string) {
    if (!USER_VIEW_ROLES.includes(role)) throw new ForbiddenException('You cannot view the user list');
    return this.prisma.user.findMany({ where: { tenantId }, select: PUBLIC_USER, orderBy: { createdAt: 'asc' } });
  }

  private checkModules(mods?: string[]) {
    const bad = (mods ?? []).filter((m) => !MODULE_KEYS.includes(m));
    if (bad.length) throw new BadRequestException(`Unknown module(s): ${bad.join(', ')}`);
  }

  private token() { return randomBytes(32).toString('hex'); }

  async createUser(tenantId: string, role: string, dto: CreateUserDto) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can add users');
    if (!ASSIGNABLE_ROLES.includes(dto.role)) throw new BadRequestException('This role cannot be given');
    this.checkModules(dto.modules);
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('A user with this email already exists');

    // Task 5: no password given → create as PENDING with an activation link instead of emailing one
    // directly (no email service is configured yet; the Owner copies this link and sends it).
    const invite = !dto.password;
    const activationToken = invite ? this.token() : null;
    const placeholder = invite ? await bcrypt.hash(this.token(), 10) : await bcrypt.hash(dto.password!, 10);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        role: dto.role as any,
        modules: dto.modules ?? [],
        customTitle: dto.customTitle?.trim() || null,
        passwordHash: placeholder,
        isActive: true,
        isVerified: !invite,
        status: invite ? 'PENDING' : 'ACTIVE',
        activationToken,
        activationExpires: invite ? new Date(Date.now() + ACTIVATION_DAYS * 86400000) : null,
      },
      select: { ...PUBLIC_USER, activationToken: true },
    });
    return { ...user, activationLink: user.activationToken ? `/activate?token=${user.activationToken}` : null };
  }

  /** Owner lost the first link, or it expired — issue a fresh one. */
  async getActivationLink(tenantId: string, role: string, id: string) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can do this');
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('User not found or access denied');
    if (user.status === 'ACTIVE') throw new BadRequestException('This user has already activated their account');
    const activationToken = this.token();
    await this.prisma.user.update({
      where: { id },
      data: { activationToken, activationExpires: new Date(Date.now() + ACTIVATION_DAYS * 86400000) },
    });
    return { activationLink: `/activate?token=${activationToken}` };
  }

  async updateUser(tenantId: string, role: string, actorId: string, id: string, dto: UpdateUserDto) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can change users');
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('User not found or access denied');
    if (user.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') throw new ForbiddenException('Platform administrators cannot be changed here');
    if (dto.role !== undefined && !ASSIGNABLE_ROLES.includes(dto.role)) throw new BadRequestException('This role cannot be given');
    this.checkModules(dto.modules);

    // Never leave the workspace without an active Owner
    const losesOwner =
      user.role === 'OWNER' && ((dto.role !== undefined && dto.role !== 'OWNER') || dto.isActive === false);
    if (losesOwner) {
      const owners = await this.prisma.user.count({ where: { tenantId, role: 'OWNER', isActive: true } });
      if (owners <= 1) throw new BadRequestException('The workspace needs at least one active Owner');
    }
    if (id === actorId && dto.isActive === false) throw new BadRequestException('You cannot deactivate yourself');

    const data: any = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.modules !== undefined) data.modules = dto.modules;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.customTitle !== undefined) data.customTitle = dto.customTitle?.trim() || null;
    if (dto.password) { data.passwordHash = await bcrypt.hash(dto.password, 10); data.status = 'ACTIVE'; data.activationToken = null; data.activationExpires = null; }
    return this.prisma.user.update({ where: { id }, data, select: PUBLIC_USER });
  }

  // ------------------------------------------------------- login history (Task 5)

  async listLoginSessions(tenantId: string, role: string, userId?: string) {
    if (!LOGIN_VIEW_ROLES.includes(role)) throw new ForbiddenException('You cannot view sign-in history');
    const where: any = { tenantId };
    if (userId) where.userId = userId;
    const rows = await this.prisma.loginSession.findMany({ where, orderBy: { loginAt: 'desc' }, take: 300 });
    const users = await this.prisma.user.findMany({ where: { tenantId }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r: any) => ({ ...r, user: byId.get(r.userId) ?? null }));
  }
}
