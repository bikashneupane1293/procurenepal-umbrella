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
import { PricingService } from '../pricing/pricing.service';
import { MailService } from '../mail/mail.service';
import { addNptDays, nptDate, nptDaysBetween, nptToday } from '../common/nepal-time';

/** Days after the expiry date during which the plan still applies (with a warning). */
export const GRACE_DAYS = 7;
/** Warn this many days before expiry. */
export const EXPIRING_SOON_DAYS = 14;
export type PlanStateName = 'NONE' | 'ACTIVE' | 'EXPIRING_SOON' | 'GRACE' | 'EXPIRED';
export interface PlanState {
  plan: string | null;
  /** the plan whose modules actually apply right now (FREE once expired; null = unrestricted) */
  effectivePlan: string | null;
  state: PlanStateName;
  /** Nepal dates, YYYY-MM-DD */
  expiresOn: string | null;
  graceEndsOn: string | null;
  /** days left until expiry (ACTIVE/EXPIRING_SOON) or until grace ends (GRACE) */
  daysLeft: number | null;
}
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
  modulesUnlockedByPlan,
  ENTITLE_PREFIX,
} from './module-registry';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const PUBLIC_USER = {
  id: true, email: true, fullName: true, phone: true, role: true, isActive: true,
  modules: true, lastLoginAt: true, createdAt: true, status: true, customTitle: true,
} as const;

const ACTIVATION_DAYS = 7;
const ITEM_KEY = /^[a-z0-9.\-]{1,60}$/i;
/** A user's `modules` list may also hold "item:<menu id>" entries (e.g. "item:fleet.fuel"):
 *  then that person sees ONLY those pages — e.g. a driver who may only enter fuel. */
export const ITEM_PREFIX = 'item:';
export const moduleOfItem = (id: string) => { const p = id.split('.')[0]; return p === 'proc' ? 'procurement' : p; };

@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService, private pricing: PricingService, private mail: MailService) {}

  // ------------------------------------------------------- workspace modules

  /**
   * The workspace's plan and where it stands (Task 11: plan expiry, Nepal Time).
   *  - NONE: Super Admin never recorded a plan → unrestricted, exactly as before Task 8.
   *  - ACTIVE / EXPIRING_SOON (≤ 14 days left): the plan applies.
   *  - GRACE: past the expiry date but within GRACE_DAYS → the plan still applies, with a warning.
   *  - EXPIRED: grace over, or the plan was marked CANCELED/EXPIRED → the FREE plan's modules apply.
   * A plan "expiring on 2026-12-31" is valid through 23:59 Nepal Time that day.
   */
  async planState(tenantId: string, now: Date = new Date()): Promise<PlanState> {
    // Latest row picked in code (the e2e in-memory DB ignores orderBy); only the columns needed,
    // so this keeps working even if newer optional columns aren't in the database yet.
    const subs = await this.prisma.subscription.findMany({
      where: { tenantId },
      select: { plan: true, createdAt: true, status: true, expiresAt: true },
    });
    if (!subs.length) return { plan: null, effectivePlan: null, state: 'NONE', expiresOn: null, graceEndsOn: null, daysLeft: null };
    const latest: any = subs.reduce((a: any, b: any) => (new Date(b.createdAt) > new Date(a.createdAt) ? b : a));
    const plan: string = latest.plan;
    const today = nptToday(now);
    const expiresOn = latest.expiresAt ? nptDate(latest.expiresAt) : null;
    const graceEndsOn = expiresOn ? addNptDays(expiresOn, GRACE_DAYS) : null;
    if (latest.status === 'CANCELED' || latest.status === 'EXPIRED') {
      return { plan, effectivePlan: 'FREE', state: 'EXPIRED', expiresOn, graceEndsOn, daysLeft: null };
    }
    if (!expiresOn) return { plan, effectivePlan: plan, state: 'ACTIVE', expiresOn: null, graceEndsOn: null, daysLeft: null };
    if (today <= expiresOn) {
      const daysLeft = nptDaysBetween(today, expiresOn);
      return { plan, effectivePlan: plan, state: daysLeft <= EXPIRING_SOON_DAYS ? 'EXPIRING_SOON' : 'ACTIVE', expiresOn, graceEndsOn, daysLeft };
    }
    if (today <= graceEndsOn!) {
      return { plan, effectivePlan: plan, state: 'GRACE', expiresOn, graceEndsOn, daysLeft: nptDaysBetween(today, graceEndsOn!) };
    }
    return { plan, effectivePlan: 'FREE', state: 'EXPIRED', expiresOn, graceEndsOn, daysLeft: null };
  }

  /** The recorded plan (null = never recorded). Kept for callers that only need the name. */
  async currentPlan(tenantId: string): Promise<string | null> {
    return (await this.planState(tenantId)).plan;
  }

  /**
   * The workspace's plan plus the modules it may use. `unlockedModules: null` = no plan ever
   * recorded → unrestricted (pre-Task-8 behaviour). Order: expired plan → FREE modules;
   * otherwise Super Admin's per-workspace choice → the plan's defaults (editable catalog).
   * Super Admin's per-workspace choice is kept while expired, so renewing restores it.
   */
  async planModulesFor(tenantId: string): Promise<{ plan: string | null; unlockedModules: string[] | null; custom: boolean; expired: boolean }> {
    const st = await this.planState(tenantId);
    const plan = st.plan;
    if (st.state === 'EXPIRED') {
      return { plan, unlockedModules: await this.pricing.planModules('FREE'), custom: false, expired: true };
    }
    const ent = await this.prisma.tenantFeatureFlag.findMany({ where: { tenantId, flagKey: { startsWith: ENTITLE_PREFIX } } });
    if (ent.length) {
      const unlocked = ent
        .filter((f: any) => f.enabled)
        .map((f: any) => String(f.flagKey).slice(ENTITLE_PREFIX.length))
        .filter((k: string) => MODULES.some((m) => m.key === k && !m.core));
      return { plan, unlockedModules: MODULE_KEYS.filter((k) => unlocked.includes(k)), custom: true, expired: false };
    }
    return { plan, unlockedModules: plan ? await this.pricing.planModules(plan) : null, custom: false, expired: false };
  }

  /**
   * { companies: true, bolpatra: true, … } — once a plan has been recorded for this workspace,
   * a module is ON only if BOTH the plan includes it AND the Owner hasn't switched it off; a
   * module the plan doesn't include is OFF even if it was switched on under an earlier plan.
   * Before any plan is recorded, this behaves exactly as before Task 8 (every non-core module
   * ON unless the Owner switched it off).
   */
  async tenantModules(tenantId: string): Promise<Record<string, boolean>> {
    const { unlockedModules } = await this.planModulesFor(tenantId);
    const flags = await this.prisma.tenantFeatureFlag.findMany({
      where: { tenantId, flagKey: { in: MODULE_KEYS.map(flagKeyOf) } },
    });
    const out: Record<string, boolean> = {};
    for (const m of MODULES) {
      if (m.core) { out[m.key] = true; continue; }
      const f = flags.find((x) => x.flagKey === flagKeyOf(m.key));
      const ownerWants = f ? f.enabled : true;
      const planAllows = unlockedModules === null || unlockedModules.includes(m.key);
      out[m.key] = planAllows && ownerWants;
    }
    return out;
  }

  async setTenantModules(tenantId: string, role: string, changes: Record<string, boolean>) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can switch modules on or off');
    const { plan, unlockedModules, expired } = await this.planModulesFor(tenantId);
    for (const [key, enabled] of Object.entries(changes)) {
      const def = MODULES.find((m) => m.key === key);
      if (!def) throw new BadRequestException(`Unknown module "${key}"`);
      if (def.core && !enabled) throw new BadRequestException(`${def.name} is a core module and cannot be switched off`);
      if (typeof enabled !== 'boolean') throw new BadRequestException(`Value for "${key}" must be true or false`);
      if (enabled && !def.core && unlockedModules !== null && !unlockedModules.includes(key)) {
        throw new BadRequestException(
          expired
            ? `Your ${plan} plan has expired, so only the FREE plan's modules are available. Ask your ProcureNepal platform administrator to renew it.`
            : `${def.name} is not included in your workspace's ${plan ? plan + ' ' : ''}plan. Ask your ProcureNepal platform administrator to add it.`,
        );
      }
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
    const list: string[] = user?.modules ?? [];
    if (!list.length) return active; // no limit set → every active module
    const own = new Set(list.map((k) => (k.startsWith(ITEM_PREFIX) ? moduleOfItem(k.slice(ITEM_PREFIX.length)) : k)));
    return active.filter((k) => MODULES.find((m) => m.key === k)?.core || own.has(k));
  }

  /** The only pages this person may open, or null = no page limit (only module limits apply). */
  async userItems(tenantId: string, userId: string, role: string): Promise<string[] | null> {
    if (ALL_ACCESS_ROLES.includes(role)) return null;
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { modules: true } });
    const items = (user?.modules ?? []).filter((k) => k.startsWith(ITEM_PREFIX)).map((k) => k.slice(ITEM_PREFIX.length));
    return items.length ? items : null;
  }

  async me(tenantId: string, userId: string, role: string) {
    const { plan, unlockedModules, custom } = await this.planModulesFor(tenantId);
    const planState = await this.planState(tenantId);
    return {
      role,
      canManage: ADMIN_ROLES.includes(role),
      canViewLogins: LOGIN_VIEW_ROLES.includes(role),
      modules: await this.effectiveModules(tenantId, userId, role),
      workspaceModules: await this.tenantModules(tenantId),
      itemFlags: await this.tenantItems(tenantId),
      userItems: await this.userItems(tenantId, userId, role),
      registry: MODULES,
      plan,
      planModules: unlockedModules,
      planCustom: custom,
      planState,
    };
  }

  // ------------------------------------------------------- user setup

  async listUsers(tenantId: string, role: string) {
    if (!USER_VIEW_ROLES.includes(role)) throw new ForbiddenException('You cannot view the user list');
    return this.prisma.user.findMany({ where: { tenantId }, select: PUBLIC_USER, orderBy: { createdAt: 'asc' } });
  }

  private checkModules(mods?: string[]) {
    const bad = (mods ?? []).filter((m) => m.startsWith(ITEM_PREFIX)
      ? !(ITEM_KEY.test(m.slice(ITEM_PREFIX.length)) && m.includes('.') && MODULE_KEYS.includes(moduleOfItem(m.slice(ITEM_PREFIX.length))))
      : !MODULE_KEYS.includes(m));
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
    const activationLink = user.activationToken ? `/activate?token=${user.activationToken}` : null;
    let emailed = false;
    if (activationLink) {
      const t: any = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      emailed = await this.mail.send({
        to: user.email, toName: user.fullName, subject: `You've been added to ${t?.name ?? 'a workspace'} on ProcureNepal`,
        lines: [`${t?.name ?? 'Your company'} has added you to ProcureNepal. Open this link to choose your password (it works for ${ACTIVATION_DAYS} days):`, this.mail.url(activationLink)],
      });
    }
    const { activationToken: _t, ...rest } = user as any;
    return { ...rest, activationLink, emailed };
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
