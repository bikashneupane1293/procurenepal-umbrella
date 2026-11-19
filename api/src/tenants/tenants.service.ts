// Platform-level admin panel: the one place that reads/writes ACROSS every tenant (workspace)
// instead of being scoped to the signed-in user's own one. Every method checks role === SUPER_ADMIN
// itself (same pattern as the ADMIN_ROLES checks elsewhere) because this must never leak into the
// ordinary per-tenant endpoints. © Cuidado Technology Pvt. Ltd.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { ENTITLE_PREFIX, GRANTABLE_MODULE_KEYS, MODULES, PLAN_MODULES, entitleFlagKeyOf } from '../access/module-registry';
import { CreateTenantDto, SetModulesDto, SetPlanDto } from './dto/admin.dto';

const PLATFORM_ROLE = 'SUPER_ADMIN';
const ACTIVATION_DAYS = 7;

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService, private access: AccessService) {}

  /** Rejects unknown or core module keys (core modules are always on and never "granted"). */
  private checkGrantable(modules: string[]) {
    const bad = modules.filter((m) => !GRANTABLE_MODULE_KEYS.includes(m));
    if (bad.length) throw new BadRequestException(`Unknown or core module(s): ${bad.join(', ')}. Choose from: ${GRANTABLE_MODULE_KEYS.join(', ')}`);
  }

  /** Writes one entitle:<key> row per grantable module (true if chosen, false if not). */
  private async writeEntitlement(db: any, tenantId: string, modules: string[]) {
    for (const key of GRANTABLE_MODULE_KEYS) {
      const enabled = modules.includes(key);
      await db.tenantFeatureFlag.upsert({
        where: { tenantId_flagKey: { tenantId, flagKey: entitleFlagKeyOf(key) } },
        create: { tenantId, flagKey: entitleFlagKeyOf(key), enabled, enabledAt: enabled ? new Date() : null },
        update: { enabled, enabledAt: enabled ? new Date() : null },
      });
    }
  }

  /** Every grantable module (name + key) and each plan's default list, for the Admin Panel UI. */
  plans(role: string) {
    this.requirePlatform(role);
    return {
      modules: MODULES.map((m) => ({ key: m.key, name: m.name, core: !!m.core })),
      presets: PLAN_MODULES,
    };
  }

  /** Super Admin chooses exactly which modules a workspace gets — or resets to its plan's default. */
  async setModules(role: string, tenantId: string, dto: SetModulesDto) {
    this.requirePlatform(role);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    if (dto.usePlanDefault) {
      await this.prisma.tenantFeatureFlag.deleteMany({ where: { tenantId, flagKey: { startsWith: ENTITLE_PREFIX } } });
    } else {
      if (!dto.modules) throw new BadRequestException('Send "modules" (the list to allow) or "usePlanDefault": true');
      this.checkGrantable(dto.modules);
      await this.writeEntitlement(this.prisma, tenantId, dto.modules);
    }
    return this.access.planModulesFor(tenantId);
  }

  private requirePlatform(role: string) {
    if (role !== PLATFORM_ROLE) throw new ForbiddenException('Platform administration is for Super Admin only');
  }

  /** Every workspace on the platform, with its user count, owner and current plan. */
  async listTenants(role: string) {
    this.requirePlatform(role);
    const tenants = await this.prisma.tenant.findMany({});
    const out: any[] = [];
    for (const t of tenants) {
      const users = await this.prisma.user.findMany({ where: { tenantId: t.id } });
      const subs = (await this.prisma.subscription.findMany({ where: { tenantId: t.id } }))
        .sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt));
      out.push({
        ...t,
        userCount: users.length,
        ownerEmail: users.find((u: any) => u.role === 'OWNER')?.email ?? null,
        plan: subs[0]?.plan ?? 'FREE',
        subStatus: subs[0]?.status ?? null,
        subExpiresAt: subs[0]?.expiresAt ?? null,
      });
    }
    return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  async getTenant(role: string, id: string) {
    this.requirePlatform(role);
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    const users = await this.prisma.user.findMany({ where: { tenantId: id } });
    const subscriptions = (await this.prisma.subscription.findMany({ where: { tenantId: id } }))
      .sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return {
      tenant,
      modules: await this.access.planModulesFor(id),
      users: users.map((u: any) => ({
        id: u.id, email: u.email, fullName: u.fullName, role: u.role, status: u.status, isActive: u.isActive, createdAt: u.createdAt,
      })),
      subscriptions,
    };
  }

  /**
   * Records a plan for a workspace. This plan now also decides which ERP modules the workspace's
   * Owner can switch on (see PLAN_MODULES in access/module-registry.ts) — but no payment is
   * collected or verified here. Use it to record a plan you've agreed with the customer and (if
   * applicable) a manually-confirmed payment reference, until a real payment gateway is connected.
   */
  async setPlan(role: string, tenantId: string, dto: SetPlanDto) {
    this.requirePlatform(role);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    if (dto.modules) this.checkGrantable(dto.modules);
    const sub = await this.prisma.subscription.create({
      data: {
        tenantId,
        plan: dto.plan as any,
        status: (dto.status ?? 'ACTIVE') as any,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        paymentMethod: dto.paymentMethod ?? 'MANUAL',
        paymentRef: dto.paymentRef ?? null,
        amountNPR: dto.amountNPR ?? null,
      },
    });
    if (dto.modules) await this.writeEntitlement(this.prisma, tenantId, dto.modules);
    return sub;
  }

  /**
   * Super Admin sets up a brand-new organization directly (Task 8) — instead of waiting for the
   * organization to self-register. Creates the Tenant, an OWNER user (PENDING, with a 7-day
   * activation link — same no-email-yet pattern as AccessService.createUser) and, if a plan was
   * given, an initial Subscription row. Everything happens in one transaction so a failure never
   * leaves a half-created workspace behind.
   */
  async createTenant(role: string, dto: CreateTenantDto) {
    this.requirePlatform(role);
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email: ownerEmail } });
    if (existingUser) throw new ConflictException('A user with this email already exists — pick a different owner email or add them to their existing workspace instead.');

    if (dto.modules) this.checkGrantable(dto.modules);
    const slug = await this.uniqueSlug(dto.tenantName);
    const activationToken = randomBytes(32).toString('hex');
    const placeholder = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.tenantName.trim(), slug, contactEmail: ownerEmail, contactPhone: dto.ownerPhone?.trim() || null },
      });
      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: ownerEmail,
          fullName: dto.ownerName.trim(),
          phone: dto.ownerPhone?.trim() || null,
          role: 'OWNER',
          passwordHash: placeholder,
          isActive: true,
          isVerified: false,
          status: 'PENDING',
          activationToken,
          activationExpires: new Date(Date.now() + ACTIVATION_DAYS * 86400000),
        },
      });
      const subscription = await tx.subscription.create({
        data: { tenantId: tenant.id, plan: (dto.plan ?? 'FREE') as any, status: 'ACTIVE', paymentMethod: 'MANUAL' },
      });
      if (dto.modules) await this.writeEntitlement(tx, tenant.id, dto.modules);
      return { tenant, owner, subscription };
    });

    return {
      tenant: result.tenant,
      owner: { id: result.owner.id, email: result.owner.email, fullName: result.owner.fullName },
      subscription: result.subscription,
      // No email service yet (same limitation as inviting a teammate) — Super Admin copies this
      // and sends it to the new owner themselves.
      ownerActivationLink: `/activate?token=${activationToken}`,
    };
  }

  /** "Acme Builders Pvt Ltd" → "acme-builders-pvt-ltd", "acme-builders-pvt-ltd-2" if taken, … */
  private async uniqueSlug(name: string): Promise<string> {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
    let slug = base;
    let n = 1;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      n += 1;
      slug = `${base}-${n}`;
    }
    return slug;
  }

  async toggleTenantActive(role: string, tenantId: string, isActive: boolean) {
    this.requirePlatform(role);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return this.prisma.tenant.update({ where: { id: tenantId }, data: { isActive } });
  }

  async stats(role: string) {
    this.requirePlatform(role);
    const tenants = await this.prisma.tenant.findMany({});
    const users = await this.prisma.user.findMany({});
    const since30 = Date.now() - 30 * 86_400_000;
    const planCounts: Record<string, number> = {};
    for (const t of tenants) {
      const subs = (await this.prisma.subscription.findMany({ where: { tenantId: t.id } }))
        .sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt));
      const plan = subs[0]?.plan ?? 'FREE';
      planCounts[plan] = (planCounts[plan] ?? 0) + 1;
    }
    return {
      totalTenants: tenants.length,
      activeTenants: tenants.filter((t: any) => t.isActive).length,
      totalUsers: users.length,
      newTenants30d: tenants.filter((t: any) => +new Date(t.createdAt) >= since30).length,
      planCounts,
    };
  }

  /** Honest placeholder — no payment gateway is connected yet (needs eSewa / Khalti merchant credentials). */
  billing(role: string) {
    this.requirePlatform(role);
    return {
      esewa: false,
      khalti: false,
      message:
        'No payment gateway is connected yet. eSewa and Khalti each need a registered merchant account ' +
        '(business registration + bank account) before they issue the merchant code and secret key this ' +
        'would need to go live. Until then, record a plan and payment manually with "Set plan" above ' +
        '(bank transfer reference, cheque number, etc.).',
    };
  }
}
