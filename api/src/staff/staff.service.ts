// Staff joining & leaving organizations (Task 12). © Cuidado Technology Pvt. Ltd.
//
//  - Every organization has an Org ID (PN-XXXXXX) its office gives to staff for fast sign-up.
//  - Every person has a personal ID (U-XXXXXX) a company can use to add them.
//  - A company ADDS a person by email or personal ID → an INVITE the person accepts (consent),
//    or — for a brand-new person signing up with Google using that exact email — joins at once.
//  - A person SIGNS UP / asks to join with an Org ID → a REQUEST the Owner approves.
//  - When a company REMOVES a person, they move to their own free personal workspace (FREE plan)
//    and keep their login, until another company adds them again.
// A person belongs to exactly one organization at a time (User.tenantId), as before.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ADMIN_ROLES, ASSIGNABLE_ROLES, MODULE_KEYS } from '../access/module-registry';
import { makeCode, normalizeCode, USER_CODE_RE } from '../common/codes';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLIC_INVITE = (i: any, tenantName?: string) => ({
  id: i.id, kind: i.kind, email: i.email, userCode: i.userCode, fullName: i.fullName, role: i.role,
  modules: i.modules ?? [], customTitle: i.customTitle, status: i.status, createdAt: i.createdAt,
  ...(tenantName !== undefined ? { organization: tenantName } : {}),
});

export type JoinResult = { result: 'JOINED' | 'REQUESTED' | 'ALREADY_MEMBER'; organization: string };

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  // ------------------------------------------------------------------ IDs

  async ensureOrgCode(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Organization not found');
    if ((t as any).orgCode) return (t as any).orgCode;
    return this.assignOrgCode(tenantId);
  }

  private async assignOrgCode(tenantId: string): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = makeCode('PN');
      if (await this.prisma.tenant.findUnique({ where: { orgCode: code } as any })) continue;
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { orgCode: code } as any });
      return code;
    }
    throw new ConflictException('Could not generate a unique Org ID — try again');
  }

  async ensureUserCode(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    if ((u as any).userCode) return (u as any).userCode;
    for (let i = 0; i < 8; i++) {
      const code = makeCode('U');
      if (await this.prisma.user.findUnique({ where: { userCode: code } as any })) continue;
      await this.prisma.user.update({ where: { id: userId }, data: { userCode: code } as any });
      return code;
    }
    throw new ConflictException('Could not generate a unique personal ID — try again');
  }

  async orgInfo(tenantId: string) {
    const orgCode = await this.ensureOrgCode(tenantId);
    const t: any = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    return { orgCode, name: t.name, personal: !!t.personalOwnerId, signupLink: this.mail.url(`/join?org=${orgCode}`) };
  }

  async regenerateOrgCode(tenantId: string, role: string) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can change the Org ID');
    await this.assignOrgCode(tenantId);
    return this.orgInfo(tenantId);
  }

  // ------------------------------------------------------------------ personal workspace

  /** The person's own free workspace — created the first time it's needed. */
  async ensurePersonalWorkspace(user: { id: string; fullName: string; email: string }, db: any = this.prisma): Promise<string> {
    const existing = await db.tenant.findUnique({ where: { personalOwnerId: user.id } });
    if (existing) return existing.id;
    const base = `personal-${user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '');
    let slug = base; let n = 1;
    while (await db.tenant.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
    const t = await db.tenant.create({
      data: { name: `${user.fullName} (personal)`, slug, contactEmail: user.email, personalOwnerId: user.id },
    });
    // An explicit FREE plan, so a personal workspace gets exactly the FREE plan's modules.
    await db.subscription.create({ data: { tenantId: t.id, plan: 'FREE', status: 'ACTIVE', paymentMethod: 'PERSONAL' } });
    return t.id;
  }

  /**
   * Creates a brand-new person in their own free personal workspace (used by sign-up with an Org
   * ID and by Google sign-up). Returns the created user.
   */
  async createPersonalUser(input: { email: string; fullName: string; phone?: string | null; password?: string | null; googleId?: string | null; verified: boolean }) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('An account with this email already exists — sign in instead');
    const passwordHash = await bcrypt.hash(input.password || randomBytes(32).toString('hex'), 10);
    return this.prisma.$transaction(async (tx: any) => {
      const temp = await tx.tenant.create({ data: { name: `${input.fullName.trim()} (personal)`, slug: `tmp-${randomBytes(6).toString('hex')}`, contactEmail: email } });
      const user = await tx.user.create({
        data: {
          tenantId: temp.id, email, fullName: input.fullName.trim(), phone: input.phone?.trim() || null, passwordHash,
          role: 'OWNER', isActive: true, isVerified: input.verified, status: 'ACTIVE', googleId: input.googleId ?? null,
        },
      });
      const base = `personal-${email.split('@')[0].replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '');
      let slug = base; let n = 1;
      while (await tx.tenant.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
      await tx.tenant.update({ where: { id: temp.id }, data: { slug, personalOwnerId: user.id } });
      await tx.subscription.create({ data: { tenantId: temp.id, plan: 'FREE', status: 'ACTIVE', paymentMethod: 'PERSONAL' } });
      return user;
    });
  }

  // ------------------------------------------------------------------ moving a person

  /** Refuses to leave a company without an active Owner. */
  private async checkCanLeave(user: any) {
    if (user.role !== 'OWNER') return;
    const t: any = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
    if (!t || t.personalOwnerId === user.id) return; // leaving your own personal workspace is fine
    const owners = await this.prisma.user.count({ where: { tenantId: user.tenantId, role: 'OWNER', isActive: true } });
    if (owners <= 1) {
      throw new BadRequestException(`You're the only Owner of ${t.name}. Make someone else Owner there first (Companies → User Setup), then try again.`);
    }
  }

  private async moveUser(user: any, tenantId: string, role: string, modules: string[], customTitle: string | null) {
    await this.checkCanLeave(user);
    return this.prisma.user.update({
      where: { id: user.id },
      data: { tenantId, role: role as any, modules, customTitle, status: 'ACTIVE', isActive: true },
    });
  }

  private validRole(role?: string) {
    const r = role ?? 'VIEWER';
    if (!ASSIGNABLE_ROLES.includes(r)) throw new BadRequestException('This role cannot be given');
    return r;
  }
  private validModules(mods?: string[]) {
    const bad = (mods ?? []).filter((m) => !MODULE_KEYS.includes(m));
    if (bad.length) throw new BadRequestException(`Unknown module(s): ${bad.join(', ')}`);
    return mods ?? [];
  }

  // ------------------------------------------------------------------ company adds a person (INVITE)

  async invite(tenantId: string, actor: { userId: string; role: string }, dto: { target: string; role?: string; modules?: string[]; customTitle?: string; fullName?: string }) {
    if (!ADMIN_ROLES.includes(actor.role)) throw new ForbiddenException('Only the workspace Owner can add staff');
    const role = this.validRole(dto.role);
    const modules = this.validModules(dto.modules);
    const raw = String(dto.target ?? '').trim();
    const byCode = USER_CODE_RE.test(normalizeCode(raw));
    let user: any = null;
    let email: string | null = null;
    if (byCode) {
      user = await this.prisma.user.findUnique({ where: { userCode: normalizeCode(raw) } as any });
      if (!user) throw new NotFoundException(`No ProcureNepal user has the ID ${normalizeCode(raw)}`);
    } else {
      if (!EMAIL_RE.test(raw)) throw new BadRequestException('Enter an email address or a personal ID like U-8H3K2M');
      email = raw.toLowerCase();
      user = await this.prisma.user.findUnique({ where: { email } });
    }
    if (user && user.tenantId === tenantId) throw new ConflictException(`${user.fullName} is already in this workspace`);
    const dupWhere: any = { tenantId, kind: 'INVITE', status: 'PENDING', ...(user ? { userId: user.id } : { email }) };
    if (await this.prisma.staffInvite.findFirst({ where: dupWhere })) throw new ConflictException('This person already has a pending invitation here');

    const tenant: any = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const orgCode = await this.ensureOrgCode(tenantId);
    const inv = await this.prisma.staffInvite.create({
      data: {
        tenantId, kind: 'INVITE', email: user?.email ?? email, userCode: user?.userCode ?? (byCode ? normalizeCode(raw) : null),
        userId: user?.id ?? null, fullName: dto.fullName?.trim() || user?.fullName || null, role: role as any, modules,
        customTitle: dto.customTitle?.trim() || null, status: 'PENDING', createdBy: actor.userId,
      },
    });
    const to = user?.email ?? email!;
    const emailed = await this.mail.send({
      to, toName: user?.fullName,
      subject: `${tenant.name} added you on ProcureNepal`,
      lines: user
        ? [`${tenant.name} has added you to their ProcureNepal workspace as ${role.replace(/_/g, ' ').toLowerCase()}.`, 'Sign in and accept the invitation on your Account page:', this.mail.url('/account')]
        : [`${tenant.name} has added you to their ProcureNepal workspace as ${role.replace(/_/g, ' ').toLowerCase()}.`, `Sign up with Google using this email address (${to}) and the Org ID ${orgCode}, and you'll join straight away:`, this.mail.url(`/join?org=${orgCode}&email=${encodeURIComponent(to)}`)],
    });
    return { invite: PUBLIC_INVITE(inv), existingAccount: !!user, emailed, signupLink: user ? null : this.mail.url(`/join?org=${orgCode}`) };
  }

  /** Pending invitations and join requests for this workspace (Owner's view). */
  async listForTenant(tenantId: string, role: string) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can see invitations');
    const rows = await this.prisma.staffInvite.findMany({ where: { tenantId, status: 'PENDING' } });
    return rows.sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt)).map((r: any) => PUBLIC_INVITE(r));
  }

  async cancel(tenantId: string, role: string, id: string) {
    if (!ADMIN_ROLES.includes(role)) throw new ForbiddenException('Only the workspace Owner can do this');
    const inv: any = await this.prisma.staffInvite.findFirst({ where: { id, tenantId, status: 'PENDING' } });
    if (!inv) throw new NotFoundException('Invitation not found');
    await this.prisma.staffInvite.update({ where: { id }, data: { status: inv.kind === 'REQUEST' ? 'DECLINED' : 'CANCELLED', decidedAt: new Date() } });
    return { ok: true };
  }

  async approve(tenantId: string, actor: { role: string }, id: string, dto: { role?: string; modules?: string[]; customTitle?: string }) {
    if (!ADMIN_ROLES.includes(actor.role)) throw new ForbiddenException('Only the workspace Owner can approve');
    const req: any = await this.prisma.staffInvite.findFirst({ where: { id, tenantId, kind: 'REQUEST', status: 'PENDING' } });
    if (!req) throw new NotFoundException('Join request not found');
    const user: any = await this.prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new NotFoundException('That account no longer exists');
    const role = this.validRole(dto.role ?? req.role);
    const modules = this.validModules(dto.modules ?? req.modules);
    await this.moveUser(user, tenantId, role, modules, dto.customTitle?.trim() || req.customTitle || null);
    await this.prisma.staffInvite.update({ where: { id }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
    const t: any = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    await this.mail.send({ to: user.email, toName: user.fullName, subject: `You've joined ${t.name} on ProcureNepal`, lines: [`${t.name} approved your request. Sign in to start working:`, this.mail.url('/login')] });
    return { ok: true, userId: user.id };
  }

  // ------------------------------------------------------------------ the person's side

  /** Pending invitations addressed to this person (by account, email or personal ID). */
  private async pendingInvitesFor(user: any) {
    const seen = new Map<string, any>();
    const wheres: any[] = [{ userId: user.id }, { email: user.email }];
    if (user.userCode) wheres.push({ userCode: user.userCode });
    for (const w of wheres) {
      for (const r of await this.prisma.staffInvite.findMany({ where: { kind: 'INVITE', status: 'PENDING', ...w } })) seen.set((r as any).id, r);
    }
    return [...seen.values()].filter((r: any) => r.tenantId !== user.tenantId);
  }

  async me(userId: string) {
    await this.ensureUserCode(userId);
    const user: any = await this.prisma.user.findUnique({ where: { id: userId } });
    const tenant: any = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
    const names = new Map<string, string>();
    const nameOf = async (tid: string) => {
      if (!names.has(tid)) names.set(tid, ((await this.prisma.tenant.findUnique({ where: { id: tid } })) as any)?.name ?? '');
      return names.get(tid)!;
    };
    const invites = [];
    for (const i of await this.pendingInvitesFor(user)) invites.push(PUBLIC_INVITE(i, await nameOf(i.tenantId)));
    const requests = [];
    for (const r of await this.prisma.staffInvite.findMany({ where: { userId, kind: 'REQUEST', status: 'PENDING' } })) requests.push(PUBLIC_INVITE(r, await nameOf((r as any).tenantId)));
    return {
      userCode: user.userCode, email: user.email, fullName: user.fullName, role: user.role,
      organization: tenant?.name ?? null, personal: tenant?.personalOwnerId === user.id,
      googleLinked: !!user.googleId, invites, requests,
    };
  }

  private publicUser(u: any) {
    return { id: u.id, email: u.email, role: u.role, tenantId: u.tenantId };
  }

  async acceptInvite(userId: string, id: string) {
    const user: any = await this.prisma.user.findUnique({ where: { id: userId } });
    const inv: any = (await this.pendingInvitesFor(user)).find((i: any) => i.id === id);
    if (!inv) throw new NotFoundException('Invitation not found or no longer open');
    const moved = await this.moveUser(user, inv.tenantId, inv.role, inv.modules ?? [], inv.customTitle ?? null);
    await this.prisma.staffInvite.update({ where: { id }, data: { status: 'ACCEPTED', decidedAt: new Date(), userId } });
    const t: any = await this.prisma.tenant.findUnique({ where: { id: inv.tenantId } });
    return { ok: true, organization: t.name, user: this.publicUser(moved) };
  }

  async declineInvite(userId: string, id: string) {
    const user: any = await this.prisma.user.findUnique({ where: { id: userId } });
    const inv: any = (await this.pendingInvitesFor(user)).find((i: any) => i.id === id);
    if (!inv) throw new NotFoundException('Invitation not found or no longer open');
    await this.prisma.staffInvite.update({ where: { id }, data: { status: 'DECLINED', decidedAt: new Date(), userId } });
    return { ok: true };
  }

  /**
   * A signed-in person asks to join an organization by its Org ID. If that organization already
   * invited them, they join straight away; otherwise the Owner gets a join request.
   */
  async requestToJoin(userId: string, orgCodeRaw: string, allowInviteAutoJoin = true): Promise<JoinResult> {
    const orgCode = normalizeCode(orgCodeRaw);
    const tenant: any = await this.prisma.tenant.findUnique({ where: { orgCode } as any });
    if (!tenant) throw new NotFoundException(`No organization has the Org ID ${orgCode || '(blank)'} — check it with your office`);
    const user: any = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user.tenantId === tenant.id) return { result: 'ALREADY_MEMBER', organization: tenant.name };
    const inv = allowInviteAutoJoin ? (await this.pendingInvitesFor(user)).find((i: any) => i.tenantId === tenant.id) : undefined;
    if (inv) {
      await this.acceptInvite(userId, inv.id);
      return { result: 'JOINED', organization: tenant.name };
    }
    const open = await this.prisma.staffInvite.findFirst({ where: { tenantId: tenant.id, kind: 'REQUEST', status: 'PENDING', userId } });
    if (!open) {
      await this.prisma.staffInvite.create({
        data: { tenantId: tenant.id, kind: 'REQUEST', email: user.email, userCode: user.userCode ?? null, userId, fullName: user.fullName, role: 'VIEWER' as any, modules: [], status: 'PENDING' },
      });
      const owners = await this.prisma.user.findMany({ where: { tenantId: tenant.id, role: 'OWNER', isActive: true } });
      for (const o of owners as any[]) {
        await this.mail.send({ to: o.email, toName: o.fullName, subject: `${user.fullName} wants to join ${tenant.name}`, lines: [`${user.fullName} (${user.email}) signed up with your Org ID and is waiting for your approval.`, 'Approve or decline in Companies → User Setup:', this.mail.url('/users')] });
      }
    }
    return { result: 'REQUESTED', organization: tenant.name };
  }

  // ------------------------------------------------------------------ company removes a person

  async removeFromCompany(tenantId: string, actor: { userId: string; role: string }, targetId: string) {
    if (!ADMIN_ROLES.includes(actor.role)) throw new ForbiddenException('Only the workspace Owner can remove staff');
    if (targetId === actor.userId) throw new BadRequestException("You can't remove yourself");
    const target: any = await this.prisma.user.findFirst({ where: { id: targetId, tenantId } });
    if (!target) throw new NotFoundException('User not found in this workspace');
    if (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('Platform administrators cannot be removed here');
    const t: any = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (t.personalOwnerId === target.id) throw new BadRequestException("This is the person's own personal workspace");
    if (target.role === 'OWNER') {
      const owners = await this.prisma.user.count({ where: { tenantId, role: 'OWNER', isActive: true } });
      if (owners <= 1) throw new BadRequestException('The workspace needs at least one active Owner');
    }
    const personalId = await this.ensurePersonalWorkspace(target);
    await this.prisma.user.update({ where: { id: target.id }, data: { tenantId: personalId, role: 'OWNER' as any, modules: [], customTitle: null } });
    await this.mail.send({ to: target.email, toName: target.fullName, subject: `You've been removed from ${t.name}`, lines: [`${t.name} removed you from their ProcureNepal workspace. Your login still works — you're now in your own free workspace, and any company can add you again with your email or personal ID.`, this.mail.url('/account')] });
    return { ok: true, movedTo: 'PERSONAL' };
  }
}
