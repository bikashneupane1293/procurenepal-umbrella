// Pricing & promotions (Task 10) — the single source of truth for plan prices, each plan's
// default modules, and promotion codes. Edited by Super Admin in the Admin Panel; stored as one
// JSON row ("pricing") in PlatformSetting. Until Super Admin saves for the first time — or if the
// PlatformSetting table hasn't been created yet (`prisma db push` not run) — the built-in defaults
// below are used, so nothing breaks in between. © Cuidado Technology Pvt. Ltd.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GRANTABLE_MODULE_KEYS, PLAN_MODULES } from '../access/module-registry';
import { nptToday } from '../common/nepal-time';

export const PLAN_KEYS = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;
export const PERIODS = ['MONTHLY', 'YEARLY'] as const;
export type BillingPeriod = (typeof PERIODS)[number];

export interface PlanPrice {
  label: string;
  /** one line shown under the plan name, e.g. "For small contractors" */
  tagline: string;
  monthlyNPR: number;
  yearlyNPR: number;
  /** default modules for workspaces on this plan (Super Admin can still override per workspace) */
  modules: string[];
  /** false = hidden from the public price list (existing customers keep it) */
  active: boolean;
}

export interface Promotion {
  /** what the customer types, e.g. DASHAIN2083 — stored upper-case */
  code: string;
  label: string;
  type: 'PERCENT' | 'FIXED';
  /** PERCENT: 1–100; FIXED: NPR amount off */
  value: number;
  /** plans it applies to; empty = every plan */
  plans: string[];
  /** billing periods it applies to; empty = both */
  periods: BillingPeriod[];
  /** YYYY-MM-DD, inclusive; null = no limit */
  validFrom: string | null;
  validTo: string | null;
  /** total redemptions allowed; null = unlimited */
  maxUses: number | null;
  active: boolean;
}

export interface PricingCatalog {
  currency: 'NPR';
  plans: Record<string, PlanPrice>;
  promotions: Promotion[];
}

export interface Quote {
  plan: string;
  period: BillingPeriod;
  listPriceNPR: number;
  discountNPR: number;
  finalNPR: number;
  promo: { code: string; label: string } | null;
  /** set when a code was given but can't be used — the price is then the list price */
  promoError?: string;
}

/** Prices start at 0 on purpose: real prices are a business decision, set in the Admin Panel. */
export function defaultCatalog(): PricingCatalog {
  const labels: Record<string, string> = { FREE: 'Free', STARTER: 'Starter', PROFESSIONAL: 'Professional', ENTERPRISE: 'Enterprise' };
  return {
    currency: 'NPR',
    plans: Object.fromEntries(
      PLAN_KEYS.map((p) => [p, { label: labels[p], tagline: '', monthlyNPR: 0, yearlyNPR: 0, modules: [...(PLAN_MODULES[p] ?? [])], active: true }]),
    ),
    promotions: [],
  };
}

const SETTING_KEY = 'pricing';
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_MS = 30_000;

@Injectable()
export class PricingService {
  private readonly log = new Logger(PricingService.name);
  private cache: { at: number; catalog: PricingCatalog; stored: boolean; updatedAt: Date | null } | null = null;

  constructor(private prisma: PrismaService) {}

  /** The current catalog (saved one merged over defaults). `stored` = false until first save. */
  async getCatalog(): Promise<{ catalog: PricingCatalog; stored: boolean; updatedAt: Date | null }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    let row: any = null;
    try {
      row = await (this.prisma as any).platformSetting.findUnique({ where: { key: SETTING_KEY } });
    } catch (e: any) {
      // Table not created yet (db push pending) — keep working on the built-in defaults.
      this.log.warn(`PlatformSetting not readable, using default pricing: ${e?.message ?? e}`);
    }
    const catalog = row?.value ? this.merge(row.value) : defaultCatalog();
    this.cache = { at: Date.now(), catalog, stored: !!row, updatedAt: row?.updatedAt ?? null };
    return this.cache;
  }

  /** Default modules for a plan — what AccessService uses when Super Admin hasn't chosen per workspace. */
  async planModules(plan: string): Promise<string[]> {
    const { catalog } = await this.getCatalog();
    return catalog.plans[plan]?.modules ?? PLAN_MODULES[plan] ?? PLAN_MODULES['FREE'];
  }

  /** Validates and saves the whole catalog. Throws 400 with a plain-English reason on bad input. */
  async saveCatalog(input: any, updatedBy: string | null): Promise<PricingCatalog> {
    const catalog = this.validate(input);
    try {
      await (this.prisma as any).platformSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: catalog, updatedBy },
        update: { value: catalog, updatedBy },
      });
    } catch (e: any) {
      throw new BadRequestException(
        'Could not save pricing — the PlatformSetting table may not exist yet. Run `npx prisma db push --config prisma7.config.ts` from api/ first. (' + (e?.message ?? e) + ')',
      );
    }
    this.cache = null;
    return catalog;
  }

  /** How many recorded subscriptions used each promo code. */
  async promoUsage(): Promise<Record<string, number>> {
    try {
      const subs = await this.prisma.subscription.findMany({ where: { promoCode: { not: null } } as any });
      const out: Record<string, number> = {};
      for (const s of subs as any[]) if (s.promoCode) out[s.promoCode] = (out[s.promoCode] ?? 0) + 1;
      return out;
    } catch {
      return {};
    }
  }

  /** Price for a plan + period, with an optional promo code checked against every rule. */
  async quote(plan: string, period: string, code?: string | null, today = new Date()): Promise<Quote> {
    if (!PLAN_KEYS.includes(plan as any)) throw new BadRequestException(`Unknown plan "${plan}"`);
    if (!PERIODS.includes(period as any)) throw new BadRequestException('Billing period must be MONTHLY or YEARLY');
    const { catalog } = await this.getCatalog();
    const p = catalog.plans[plan];
    const list = period === 'YEARLY' ? p.yearlyNPR : p.monthlyNPR;
    const base: Quote = { plan, period: period as BillingPeriod, listPriceNPR: list, discountNPR: 0, finalNPR: list, promo: null };
    const c = (code ?? '').trim().toUpperCase();
    if (!c) return base;

    const promo = catalog.promotions.find((x) => x.code === c);
    const fail = (why: string): Quote => ({ ...base, promoError: why });
    if (!promo) return fail(`Promo code ${c} does not exist`);
    if (!promo.active) return fail(`Promo code ${c} is switched off`);
    const day = nptToday(today); // promo dates follow Nepal Time
    if (promo.validFrom && day < promo.validFrom) return fail(`Promo code ${c} starts on ${promo.validFrom}`);
    if (promo.validTo && day > promo.validTo) return fail(`Promo code ${c} ended on ${promo.validTo}`);
    if (promo.plans.length && !promo.plans.includes(plan)) return fail(`Promo code ${c} does not apply to the ${plan} plan`);
    if (promo.periods.length && !promo.periods.includes(period as BillingPeriod)) return fail(`Promo code ${c} only applies to ${promo.periods.join('/').toLowerCase()} billing`);
    if (promo.maxUses != null) {
      const used = (await this.promoUsage())[c] ?? 0;
      if (used >= promo.maxUses) return fail(`Promo code ${c} has been used up (${used} of ${promo.maxUses})`);
    }
    if (list <= 0) return fail(`The ${plan} plan has no price set, so there is nothing to discount`);
    const discount = promo.type === 'PERCENT' ? Math.round((list * promo.value) / 100) : Math.min(promo.value, list);
    return { ...base, discountNPR: discount, finalNPR: list - discount, promo: { code: promo.code, label: promo.label } };
  }

  // ------------------------------------------------------------------ helpers

  /** Fills anything missing in a stored catalog from the defaults (e.g. a plan added later). */
  private merge(stored: any): PricingCatalog {
    const d = defaultCatalog();
    const plans: Record<string, PlanPrice> = {};
    for (const k of PLAN_KEYS) plans[k] = { ...d.plans[k], ...(stored?.plans?.[k] ?? {}) };
    return { currency: 'NPR', plans, promotions: Array.isArray(stored?.promotions) ? stored.promotions : [] };
  }

  private validate(input: any): PricingCatalog {
    const bad = (msg: string) => { throw new BadRequestException(msg); };
    if (!input || typeof input !== 'object') bad('Send the pricing catalog as JSON');
    const plans: Record<string, PlanPrice> = {};
    for (const k of PLAN_KEYS) {
      const p = input.plans?.[k];
      if (!p) bad(`Missing plan ${k}`);
      const money = (v: any, what: string) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) bad(`${k}: ${what} must be 0 or more`);
        return Math.round(n * 100) / 100;
      };
      const mods: string[] = Array.isArray(p.modules) ? p.modules : bad(`${k}: modules must be a list`);
      const unknown = mods.filter((m) => !GRANTABLE_MODULE_KEYS.includes(m));
      if (unknown.length) bad(`${k}: unknown or core module(s) ${unknown.join(', ')}`);
      plans[k] = {
        label: String(p.label ?? k).trim().slice(0, 40) || k,
        tagline: String(p.tagline ?? '').trim().slice(0, 120),
        monthlyNPR: money(p.monthlyNPR, 'monthly price'),
        yearlyNPR: money(p.yearlyNPR, 'yearly price'),
        modules: GRANTABLE_MODULE_KEYS.filter((m) => mods.includes(m)),
        active: p.active !== false,
      };
    }
    const promos: Promotion[] = [];
    const seen = new Set<string>();
    for (const [i, raw] of (Array.isArray(input.promotions) ? input.promotions : []).entries()) {
      const where = `Promotion ${i + 1}`;
      const code = String(raw?.code ?? '').trim().toUpperCase();
      if (!CODE_RE.test(code)) bad(`${where}: code must be 3–30 letters, digits, - or _ (got "${raw?.code ?? ''}")`);
      if (seen.has(code)) bad(`${where}: code ${code} is used twice`);
      seen.add(code);
      const type = raw.type === 'FIXED' ? 'FIXED' : raw.type === 'PERCENT' ? 'PERCENT' : bad(`${code}: type must be PERCENT or FIXED`);
      const value = Number(raw.value);
      if (!Number.isFinite(value) || value <= 0) bad(`${code}: discount must be more than 0`);
      if (type === 'PERCENT' && value > 100) bad(`${code}: a percentage discount can't be more than 100`);
      const planList: string[] = Array.isArray(raw.plans) ? raw.plans : [];
      if (planList.some((p) => !PLAN_KEYS.includes(p as any))) bad(`${code}: unknown plan in "plans"`);
      const periodList: string[] = Array.isArray(raw.periods) ? raw.periods : [];
      if (periodList.some((p) => !PERIODS.includes(p as any))) bad(`${code}: periods must be MONTHLY and/or YEARLY`);
      const date = (v: any, what: string) => {
        if (v == null || v === '') return null;
        if (!DATE_RE.test(String(v)) || isNaN(new Date(String(v)).getTime())) bad(`${code}: ${what} must be a date (YYYY-MM-DD)`);
        return String(v);
      };
      const validFrom = date(raw.validFrom, 'start date');
      const validTo = date(raw.validTo, 'end date');
      if (validFrom && validTo && validFrom > validTo) bad(`${code}: end date is before start date`);
      let maxUses: number | null = null;
      if (raw.maxUses != null && raw.maxUses !== '') {
        maxUses = Number(raw.maxUses);
        if (!Number.isInteger(maxUses) || maxUses < 1) bad(`${code}: max uses must be a whole number of 1 or more (or empty for unlimited)`);
      }
      promos.push({
        code, label: String(raw.label ?? '').trim().slice(0, 80) || code, type, value,
        plans: PLAN_KEYS.filter((p) => planList.includes(p)), periods: PERIODS.filter((p) => periodList.includes(p)),
        validFrom, validTo, maxUses, active: raw.active !== false,
      });
    }
    return { currency: 'NPR', plans, promotions: promos };
  }
}
