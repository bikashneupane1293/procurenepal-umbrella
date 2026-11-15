// Platform-level admin panel: the one place that reads/writes ACROSS every tenant (workspace)
// instead of being scoped to the signed-in user's own one. Every method checks role === SUPER_ADMIN
// itself (same pattern as the ADMIN_ROLES checks elsewhere) because this must never leak into the
// ordinary per-tenant endpoints. © Cuidado Technology Pvt. Ltd.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetPlanDto } from './dto/admin.dto';

const PLATFORM_ROLE = 'SUPER_ADMIN';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

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
      users: users.map((u: any) => ({
        id: u.id, email: u.email, fullName: u.fullName, role: u.role, status: u.status, isActive: u.isActive, createdAt: u.createdAt,
      })),
      subscriptions,
    };
  }

  /**
   * Records a plan for a workspace. This only LABELS the workspace — it does not yet gate any
   * module or feature by plan (that mapping hasn't been decided), and no payment is collected or
   * verified here. Use it to record a plan you've agreed with the customer and (if applicable) a
   * manually-confirmed payment reference, until a real payment gateway is connected.
   */
  async setPlan(role: string, tenantId: string, dto: SetPlanDto) {
    this.requirePlatform(role);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return this.prisma.subscription.create({
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
