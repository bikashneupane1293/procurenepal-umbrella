// Activity log (Task 15): every successful change (POST / PUT / PATCH / DELETE) by a signed-in person
// is written to AuditLog — who, when, what. Read back as plain sentences for Owners and Directors.
// © Cuidado Technology Pvt. Ltd.
import { CallHandler, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Logger, NestInterceptor, Query, UseGuards } from '@nestjs/common';
import { tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ACTIVITY_VIEW_ROLES } from '../access/module-registry';
import { entityDef } from '../erp/erp.registry';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /pass|token|secret|credential|hash/i;
const SKIP = [/^\/auth\//, /^\/demo\//, /^\/pricing\/quote/];

/** "/erp/records/fleet.fuel/2f…" → "/erp/records/fleet.fuel/:id" */
export const pathPattern = (path: string) => path.split('?')[0].split('/').map((p) => (ID.test(p) ? ':id' : p)).join('/');

function clean(v: any, depth = 0): any {
  if (v == null || typeof v !== 'object') return typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  if (depth > 3) return '…';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).slice(0, 40).map(([k, x]) => [k, clean(x, depth + 1)]));
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private log = new Logger('Audit');
  constructor(private prisma: PrismaService) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const method = String(req?.method ?? '').toUpperCase();
    const path = String(req?.originalUrl ?? req?.url ?? '');
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || SKIP.some((r) => r.test(path))) return next.handle();
    return next.handle().pipe(tap((result: any) => {
      const u = req.user;
      if (!u?.userId) return;
      const parts = path.split('?')[0].split('/');
      const entityId = result?.id ?? parts.reverse().find((p: string) => ID.test(p)) ?? null;
      this.prisma.auditLog.create({ data: {
        tenantId: u.tenantId, userId: u.userId, actionType: method, entityType: pathPattern(path), entityId: entityId ? String(entityId) : null,
        newValue: clean(req.body ?? null), ipAddress: String(req.headers?.['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim() || null,
      } as any }).catch((e: any) => this.log.warn(`not logged: ${e?.message}`));
    }));
  }
}

const NOUN: [RegExp, string][] = [
  [/^\/companies/, 'company'], [/^\/certificates/, 'certificate'], [/^\/tenders\/:id\/requirements/, 'tender requirements'], [/^\/tenders/, 'tender'],
  [/^\/bids/, 'bid'], [/^\/banks/, 'bank'], [/^\/bank-guarantees|^\/guarantees/, 'bank guarantee'], [/^\/projects/, 'project'], [/^\/boq/, 'BOQ'],
  [/^\/users/, 'user'], [/^\/staff/, 'staff'], [/^\/access/, 'module settings'], [/^\/qualification/, 'qualification check'], [/^\/turnover/, 'turnover'],
  [/^\/admin\/pricing/, 'pricing'], [/^\/admin/, 'workspace (admin)'], [/^\/references/, 'external reference'],
];

/** Plain-language line for one log row. */
export function describe(r: { actionType: string; entityType: string | null; newValue: any }): { action: string; what: string; detail: string } {
  const p = r.entityType ?? '';
  const action = { POST: 'added', PUT: 'saved', PATCH: 'changed', DELETE: 'deleted' }[r.actionType] ?? r.actionType.toLowerCase();
  const v = r.newValue ?? {};
  const d = v.data ?? v;
  const detail = [d.name, d.title, d.ifbNumber, d.projectTitle, d.billNo, d.regNo, d.fullName, d.email, d.number, d.vehicle && d.litres ? `${d.litres} l` : null, d.status]
    .filter((x) => x != null && x !== '').slice(0, 2).join(' · ');
  const erp = p.match(/^\/erp\/(records|actions)\/([\w.-]+)/);
  if (erp?.[1] === 'records') return { action, what: entityDef(erp[2])?.one ?? erp[2], detail };
  if (erp?.[1] === 'actions') return { action: 'ran', what: erp[2].replace(/-/g, ' '), detail };
  const n = NOUN.find(([re]) => re.test(p));
  return { action, what: n ? n[1] : p, detail };
}

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: any, @Query('limit') limit?: string) {
    if (!ACTIVITY_VIEW_ROLES.includes(u.role)) throw new ForbiddenException('Only the Owner or a Director can see the activity log');
    const n = Math.min(Math.max(Number(limit) || 300, 1), 5000);
    const rows = ((await this.prisma.auditLog.findMany({ where: { tenantId: u.tenantId }, orderBy: { createdAt: 'desc' }, take: n } as any)) as any[])
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, n);
    const users = new Map(((await this.prisma.user.findMany({ where: { tenantId: u.tenantId } })) as any[]).map((x) => [x.id, x]));
    return rows.map((r) => {
      const who: any = users.get(r.userId);
      return { id: r.id, at: r.createdAt, who: who ? who.fullName || who.email : 'Former user', email: who?.email ?? null, ...describe(r), ip: r.ipAddress };
    });
  }
}
