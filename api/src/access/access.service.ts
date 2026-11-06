import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ROLES,
  ALL_ACCESS_ROLES,
  ASSIGNABLE_ROLES,
  MODULES,
  MODULE_KEYS,
  USER_VIEW_ROLES,
  flagKeyOf,
} from './module-registry';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const PUBLIC_USER = {
  id: true, email: true, fullName: true, phone: true, role: true, isActive: true,
  modules: true, lastLoginAt: true, createdAt: true,
} as const;

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
      modules: await this.effectiveModules(tenantId, userId, role),
      workspaceModules: await this.tenantModules(tenantId),
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

  async createUser(tenantId: string, role: string, dto: CreateUserDto) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can add users');
    if (!ASSIGNABLE_ROLES.includes(dto.role)) throw new BadRequestException('This role cannot be given');
    this.checkModules(dto.modules);
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('A user with this email already exists');
    return this.prisma.user.create({
      data: {
        tenantId,
        email,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        role: dto.role as any,
        modules: dto.modules ?? [],
        passwordHash: await bcrypt.hash(dto.password, 10),
        isActive: true,
        isVerified: true,
      },
      select: PUBLIC_USER,
    });
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
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.update({ where: { id }, data, select: PUBLIC_USER });
  }
}
