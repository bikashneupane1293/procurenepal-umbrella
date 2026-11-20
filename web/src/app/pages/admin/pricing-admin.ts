// Pricing & promotions editor (Task 10) — Super Admin only, embedded in the Admin Panel.
// Prices, each plan's default modules and promotion codes are one catalog, saved together.
// © Cuidado Technology Pvt. Ltd.
import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { nptDate } from '../../core/nepal-time';

const PLANS = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];
const iso = (d: Date) => nptDate(d);
const addDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

@Component({
  selector: 'app-pricing-admin',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="panel">
      <h2>💰 Pricing &amp; promotions</h2>
      @if (!cat()) {
        <p class="help">Loading…</p>
      } @else {
        <p class="help">
          @if (stored()) { Saved {{ updatedAt() | date: 'yyyy-MM-dd HH:mm' }}. }
          @else { <strong>Not saved yet</strong> — showing built-in defaults (all prices 0). Set your prices and press Save. }
          Prices and each plan's default modules apply to workspaces on that plan unless you chose modules for a workspace yourself.
          The public price list (<code>/pricing</code>) shows plans marked "On price list"; promotion codes are never listed publicly.
        </p>

        <h3>Plan prices (NPR)</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Plan</th><th>Name shown</th><th>Tagline</th><th class="num">Monthly</th><th class="num">Yearly</th><th>Yearly saving</th><th>On price list</th></tr></thead>
          <tbody>
            @for (k of plans; track k) {
              <tr>
                <td><span class="tag gold">{{ k }}</span></td>
                <td><input [(ngModel)]="cat().plans[k].label" class="w-s" /></td>
                <td><input [(ngModel)]="cat().plans[k].tagline" placeholder="e.g. For small contractors" /></td>
                <td class="num"><input type="number" min="0" [(ngModel)]="cat().plans[k].monthlyNPR" class="w-n" /></td>
                <td class="num"><input type="number" min="0" [(ngModel)]="cat().plans[k].yearlyNPR" class="w-n" /></td>
                <td class="muted">{{ yearlySaving(k) }}</td>
                <td><input type="checkbox" [(ngModel)]="cat().plans[k].active" /></td>
              </tr>
            }
          </tbody>
        </table></div>
        <div class="tools">
          <button class="btn light small" (click)="fillYearly(10)">Yearly = 10 × monthly (2 months free)</button>
          <button class="btn light small" (click)="fillYearly(12)">Yearly = 12 × monthly (no saving)</button>
        </div>

        <h3>Default modules per plan</h3>
        <p class="help">Which modules a workspace gets on each plan. Changing this affects every workspace on that plan straight away (after its users refresh), except workspaces whose modules you chose individually.</p>
        <div class="table-wrap"><table class="matrix">
          <thead><tr><th>Module</th>@for (k of plans; track k) { <th class="c">{{ k }}</th> }</tr></thead>
          <tbody>
            <tr class="muted"><td>Companies (always on)</td>@for (k of plans; track k) { <td class="c">✓</td> }</tr>
            @for (m of grantable(); track m.key) {
              <tr>
                <td>{{ m.name }}</td>
                @for (k of plans; track k) {
                  <td class="c"><input type="checkbox" [checked]="cat().plans[k].modules.includes(m.key)" (change)="toggleModule(k, m.key)" /></td>
                }
              </tr>
            }
          </tbody>
        </table></div>

        <h3>Promotions</h3>
        <p class="help">Quick start — adds a ready-made promotion you can then edit:</p>
        <div class="tools">
          <button class="btn light small" (click)="quick('festival')">🎉 Festival: 20% off, next 30 days</button>
          <button class="btn light small" (click)="quick('yearly')">📅 Yearly: 2 months free</button>
          <button class="btn light small" (click)="quick('fixed')">💵 NPR 5,000 off</button>
          <button class="btn light small" (click)="quick('single')">🎟️ One customer: 50% off</button>
          <button class="btn light small" (click)="quick('blank')">+ Blank</button>
        </div>
        @if (cat().promotions.length) {
          @for (p of cat().promotions; track $index; let i = $index) {
            <div class="promo">
              <div class="promo-head">
                <input [(ngModel)]="p.code" (ngModelChange)="p.code = ($event || '').toUpperCase()" class="code" placeholder="CODE" />
                <span class="tag" [class]="'tag st-' + status(p).cls">{{ status(p).text }}</span>
                <span class="muted">used {{ usage()[p.code] ?? 0 }}{{ p.maxUses ? ' of ' + p.maxUses : '' }}</span>
                <label class="inline right"><input type="checkbox" [(ngModel)]="p.active" /> Switched on</label>
                <button class="btn light small" (click)="removePromo(i)">🗑 Remove</button>
              </div>
              <div class="promo-grid">
                <div class="wide"><label>Description (for your records)</label><input [(ngModel)]="p.label" placeholder="e.g. Dashain offer" /></div>
                <div>
                  <label>Discount</label>
                  <div class="row"><input type="number" min="0" [(ngModel)]="p.value" /><select [(ngModel)]="p.type"><option value="PERCENT">% off</option><option value="FIXED">NPR off</option></select></div>
                </div>
                <div>
                  <label>Billing</label>
                  <select [ngModel]="periodOf(p)" (ngModelChange)="setPeriod(p, $event)">
                    <option value="ALL">Monthly and yearly</option><option value="MONTHLY">Monthly only</option><option value="YEARLY">Yearly only</option>
                  </select>
                </div>
                <div><label>Starts</label><input type="date" [(ngModel)]="p.validFrom" /></div>
                <div><label>Ends</label><input type="date" [(ngModel)]="p.validTo" /></div>
                <div><label>Max uses</label><input type="number" min="1" [(ngModel)]="p.maxUses" placeholder="Unlimited" /></div>
                <div class="wide">
                  <label>Plans</label>
                  <div class="row chips">
                    @for (k of plans; track k) {
                      <label class="chip" [class.on]="p.plans.includes(k)"><input type="checkbox" [checked]="p.plans.includes(k)" (change)="togglePromoPlan(p, k)" />{{ k }}</label>
                    }
                    <span class="muted">{{ p.plans.length ? '' : '(none ticked = all plans)' }}</span>
                  </div>
                </div>
              </div>
            </div>
          }
        } @else {
          <p class="muted">No promotions yet.</p>
        }

        @if (error()) { <div class="msg error" style="margin-top:10px">{{ error() }}</div> }
        @if (msg()) { <div class="msg info" style="margin-top:10px">{{ msg() }}</div> }
        <div class="actions">
          <button class="btn gold" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save pricing & promotions' }}</button>
          <button class="btn light" (click)="load()" [disabled]="saving()">Discard changes</button>
        </div>

        <h3>Price checker</h3>
        <p class="help">Uses the <em>saved</em> prices and codes — save first if you just changed something.</p>
        <div class="tools">
          <select [(ngModel)]="chk.plan">@for (k of plans; track k) { <option [value]="k">{{ k }}</option> }</select>
          <select [(ngModel)]="chk.period"><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select>
          <input [(ngModel)]="chk.code" placeholder="Promo code (optional)" class="w-code" />
          <button class="btn light small" (click)="check()">Check price</button>
        </div>
        @if (chkResult(); as q) {
          <div class="msg" [class.error]="q.promoError" [class.info]="!q.promoError" style="margin-top:8px">
            {{ q.plan }} {{ q.period.toLowerCase() }}: list NPR {{ lakh(q.listPriceNPR) }}
            @if (q.promo) { − {{ q.promo.code }} ({{ q.promo.label }}) NPR {{ lakh(q.discountNPR) }} }
            = <strong>NPR {{ lakh(q.finalNPR) }}</strong>
            @if (q.promoError) { — {{ q.promoError }} }
          </div>
        }
      }
    </div>
  `,
  styles: [UI_STYLES, `
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 20px 0 8px; }
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
    .tools select, .tools input { width: auto; }
    td input:not([type=checkbox]), td select { padding: 6px 8px; font-size: 13px; }
    td input[type=checkbox] { width: auto; }
    .w-s { width: 120px; } .w-n { width: 110px; text-align: right; } .w-v { width: 80px; } .w-t { width: 70px; } .w-code { width: 130px; text-transform: uppercase; }
    .c { text-align: center; }
    .nowrap { white-space: nowrap; }
    .muted { color: #9ca3af; font-size: 12px; }
    .btn.small { padding: 6px 12px; font-size: 13px; }
    .chip { display: inline-flex; align-items: center; gap: 2px; border: 1px solid #e1e3e6; border-radius: 6px; padding: 2px 6px; margin: 0 2px 0 0; font-size: 12px; cursor: pointer; color: #9ca3af; }
    .chip.on { background: #fef3c7; border-color: #d4a017; color: #0a1f3d; font-weight: 600; }
    .chip input { display: none; }
    label.inline { display: inline-flex; gap: 4px; align-items: center; margin-right: 6px; font-weight: 600; }
    .promo { border: 1px solid #e1e3e6; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
    .promo-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
    .promo-head .code { width: 180px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
    .promo-head .right { margin-left: auto; }
    .promo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px 14px; }
    .promo-grid .wide { grid-column: span 2; }
    .promo-grid label:not(.chip) { display: block; font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
    .promo-grid .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .promo-grid .row { flex-wrap: nowrap; }
    .promo-grid .row input[type=number] { width: 90px; flex: 0 0 90px; }
    .promo-grid .row select { width: auto; flex: 1 1 auto; min-width: 0; }
    .promo-grid .row.chips { flex-wrap: wrap; }
    .promo-head .right { white-space: nowrap; }
    .chip { font-size: 12px; padding: 4px 10px; }
    @media (max-width: 640px) { .promo-grid .wide { grid-column: auto; } }
    .tag.st-live { background: #dcfce7; color: #15803d; }
    .tag.st-sched { background: #e0f2fe; color: #0369a1; }
    .tag.st-off, .tag.st-expired, .tag.st-used { background: #f3f4f6; color: #6b7280; }
  `],
})
export class PricingAdmin {
  private data = inject(DataService);
  @Output() saved = new EventEmitter<void>();

  readonly plans = PLANS;
  cat = signal<any | null>(null);
  stored = signal(false);
  updatedAt = signal<string | null>(null);
  usage = signal<Record<string, number>>({});
  grantable = signal<{ key: string; name: string }[]>([]);
  saving = signal(false);
  error = signal('');
  msg = signal('');
  chk = { plan: 'STARTER', period: 'MONTHLY', code: '' };
  chkResult = signal<any | null>(null);

  constructor() { this.load(); }

  async load() {
    this.error.set(''); this.msg.set('');
    try {
      const [p, plans] = await Promise.all([this.data.adminPricing(), this.data.adminPlans()]);
      const c = structuredClone(p.catalog);
      for (const pr of c.promotions) { pr.validFrom = pr.validFrom ?? ''; pr.validTo = pr.validTo ?? ''; }
      this.cat.set(c);
      this.stored.set(!!p.stored);
      this.updatedAt.set(p.updatedAt ?? null);
      this.usage.set(p.usage ?? {});
      this.grantable.set((plans.modules ?? []).filter((m: any) => !m.core));
    } catch (e: any) {
      this.error.set('Could not load pricing: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
  }

  lakh(n: number) { return Number(n ?? 0).toLocaleString('en-IN'); }

  yearlySaving(k: string): string {
    const p = this.cat().plans[k];
    const full = Number(p.monthlyNPR) * 12;
    if (!full || !Number(p.yearlyNPR)) return '—';
    const pct = Math.round((1 - Number(p.yearlyNPR) / full) * 100);
    return pct > 0 ? `${pct}% vs monthly` : pct < 0 ? `costs ${-pct}% more` : 'no saving';
  }

  fillYearly(months: number) {
    for (const k of PLANS) { const p = this.cat().plans[k]; p.yearlyNPR = Math.round(Number(p.monthlyNPR || 0) * months); }
  }

  toggleModule(plan: string, key: string) {
    const mods: string[] = this.cat().plans[plan].modules;
    const i = mods.indexOf(key);
    if (i >= 0) mods.splice(i, 1); else mods.push(key);
  }

  togglePromoPlan(p: any, k: string) {
    const i = p.plans.indexOf(k);
    if (i >= 0) p.plans.splice(i, 1); else p.plans.push(k);
  }
  periodOf(p: any) { return p.periods?.length === 1 ? p.periods[0] : 'ALL'; }
  setPeriod(p: any, v: string) { p.periods = v === 'ALL' ? [] : [v]; }

  private uniqueCode(base: string) {
    const taken = new Set(this.cat().promotions.map((p: any) => String(p.code).toUpperCase()));
    let code = base; let n = 2;
    while (taken.has(code)) code = `${base}${n++}`;
    return code;
  }

  quick(kind: 'festival' | 'yearly' | 'fixed' | 'single' | 'blank') {
    const base = { plans: [] as string[], periods: [] as string[], validFrom: iso(new Date()), validTo: '', maxUses: null as number | null, active: true };
    const t: Record<string, any> = {
      festival: { code: 'FESTIVAL20', label: 'Festival offer — 20% off', type: 'PERCENT', value: 20, validTo: addDays(30) },
      yearly: { code: 'YEARLY2FREE', label: 'Pay yearly, get 2 months free', type: 'PERCENT', value: 17, periods: ['YEARLY'] },
      fixed: { code: 'SAVE5000', label: 'NPR 5,000 off', type: 'FIXED', value: 5000 },
      single: { code: 'VIP50', label: 'Special: 50% off for one customer', type: 'PERCENT', value: 50, maxUses: 1 },
      blank: { code: this.uniqueCode('PROMO'), label: '', type: 'PERCENT', value: 10 },
    };
    const p = { ...base, ...t[kind] };
    p.code = this.uniqueCode(p.code);
    this.cat().promotions.push(p);
    this.msg.set(`Added ${p.code} — edit it if needed, then press Save.`);
  }

  removePromo(i: number) {
    const p = this.cat().promotions[i];
    if ((this.usage()[p.code] ?? 0) > 0) {
      this.msg.set(`${p.code} has been used ${this.usage()[p.code]} time(s) — consider unticking "on" instead of deleting, so its history stays readable.`);
    }
    this.cat().promotions.splice(i, 1);
  }

  status(p: any): { text: string; cls: string } {
    const today = iso(new Date());
    if (!p.active) return { text: 'Off', cls: 'off' };
    if (p.validTo && today > p.validTo) return { text: 'Expired', cls: 'expired' };
    if (p.maxUses && (this.usage()[p.code] ?? 0) >= p.maxUses) return { text: 'Used up', cls: 'used' };
    if (p.validFrom && today < p.validFrom) return { text: 'Scheduled', cls: 'sched' };
    return { text: 'Live', cls: 'live' };
  }

  async save() {
    this.saving.set(true); this.error.set(''); this.msg.set('');
    try {
      const c = structuredClone(this.cat());
      for (const p of c.promotions) {
        p.validFrom = p.validFrom || null; p.validTo = p.validTo || null;
        p.maxUses = p.maxUses === '' || p.maxUses == null ? null : Number(p.maxUses);
        p.value = Number(p.value);
      }
      for (const k of PLANS) { c.plans[k].monthlyNPR = Number(c.plans[k].monthlyNPR || 0); c.plans[k].yearlyNPR = Number(c.plans[k].yearlyNPR || 0); }
      await this.data.adminSavePricing(c);
      await this.load();
      this.msg.set('✅ Pricing & promotions saved.');
      this.saved.emit();
    } catch (e: any) {
      this.error.set('Not saved: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
    this.saving.set(false);
  }

  async check() {
    try {
      this.chkResult.set(await this.data.adminQuote({ plan: this.chk.plan, period: this.chk.period, code: this.chk.code || undefined }));
    } catch (e: any) {
      this.chkResult.set({ plan: this.chk.plan, period: this.chk.period, listPriceNPR: 0, discountNPR: 0, finalNPR: 0, promoError: e?.error?.message ?? 'error' });
    }
  }
}
