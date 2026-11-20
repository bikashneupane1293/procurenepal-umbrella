// Platform admin panel — Super Admin only. Lists every workspace on the platform (not just the
// signed-in person's own one), lets Super Admin record a plan / payment manually, pause a
// workspace, and shows honest platform-wide numbers. Billing is a labelled placeholder until
// eSewa / Khalti merchant credentials exist. © Cuidado Technology Pvt. Ltd.
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { PricingAdmin } from './pricing-admin';
import { nptToday } from '../../core/nepal-time';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, DatePipe, DecimalPipe, LowerCasePipe, PricingAdmin],
  template: `
    <h1>🛡️ Admin Panel</h1>
    <p class="sub">Platform-wide — every workspace on ProcureNepal, not just your own.</p>

    @if (!isSuperAdmin()) {
      <div class="msg error">This page is for platform Super Admins only. If you believe you should have access, ask whoever manages the ProcureNepal platform account.</div>
    } @else {
      @if (error()) { <div class="msg error">{{ error() }}</div> }

      <div class="panel">
        <h2>Daily jobs</h2>
        <p class="help">Morning alerts go out by themselves at 7:00 AM Nepal Time to each workspace's Owners and Directors (needs Brevo). The public demo rebuilds itself every day at 3:00 AM.</p>
        <div class="tools">
          <button class="btn light" (click)="runDigest()" [disabled]="jobBusy()">📧 Send morning alerts now</button>
          <button class="btn light" (click)="resetDemo()" [disabled]="jobBusy()">🔄 Rebuild the demo workspace</button>
        </div>
        @if (jobMsg()) { <div class="msg info" style="margin-top:10px">{{ jobMsg() }}</div> }
      </div>

      <div class="panel">
        <h2>Platform at a glance</h2>
        @if (stats(); as s) {
          <div class="grid">
            <div class="stat"><span>Workspaces</span><strong>{{ s.totalTenants }}</strong></div>
            <div class="stat"><span>Active workspaces</span><strong>{{ s.activeTenants }}</strong></div>
            <div class="stat"><span>Total users</span><strong>{{ s.totalUsers }}</strong></div>
            <div class="stat"><span>New workspaces (30 days)</span><strong>{{ s.newTenants30d }}</strong></div>
          </div>
          <div class="plan-counts">
            @for (k of planKeys(s.planCounts); track k) {
              <span class="tag gold">{{ k }}: {{ s.planCounts[k] }}</span>
            }
            @if (s.expiry) {
              @if (s.expiry.expiringSoon) { <span class="tag st-soon">Expiring within 14 days: {{ s.expiry.expiringSoon }}</span> }
              @if (s.expiry.inGrace) { <span class="tag st-grace">In 7-day grace: {{ s.expiry.inGrace }}</span> }
              @if (s.expiry.expired) { <span class="tag st-exp">Expired → FREE modules: {{ s.expiry.expired }}</span> }
            }
          </div>
        } @else {
          <p class="help">Loading…</p>
        }
      </div>

      @if (createdLink()) {
        <div class="panel link-panel">
          <h2>🔗 New organization created — {{ createdTenantName() }}</h2>
          <p class="help">
            @if (createdEmailed()) { ✅ The activation link was emailed to the new owner. It's also below, in case it doesn't arrive. }
            @else { Email sending isn't set up yet, so send this link to the new owner yourself (WhatsApp, SMS, email) so they can set their own password. }
            The link works for 7 days.
          </p>
          <div class="linkbox">
            <code>{{ fullLink(createdLink()!) }}</code>
            <button class="btn light small" (click)="copyLink(createdLink()!)">{{ copied() ? '✅ Copied' : '📋 Copy' }}</button>
          </div>
        </div>
      }

      <div class="panel">
        <h2>Create a new organization</h2>
        <p class="help">Set up a brand-new workspace directly, with its owner and starting plan — instead of waiting for them to self-register. The owner is created pending activation, same as inviting a teammate inside a workspace.</p>
        <div class="grid">
          <div>
            <label>Organization / company name</label>
            <input [(ngModel)]="createForm.tenantName" placeholder="e.g. Himalaya Builders Pvt. Ltd." />
          </div>
          <div>
            <label>Owner's full name</label>
            <input [(ngModel)]="createForm.ownerName" placeholder="e.g. Bikash Shrestha" />
          </div>
          <div>
            <label>Owner's email</label>
            <input type="email" [(ngModel)]="createForm.ownerEmail" placeholder="owner@example.com" />
          </div>
          <div>
            <label>Owner's phone (optional)</label>
            <input [(ngModel)]="createForm.ownerPhone" placeholder="98XXXXXXXX" />
          </div>
          <div>
            <label>Starting plan</label>
            <select [ngModel]="createForm.plan" (ngModelChange)="createForm.plan = $event; createMods = presetMap($event)">
              @for (p of planNames; track p) { <option [value]="p">{{ p }}</option> }
            </select>
          </div>
        </div>
        <label style="margin-top:12px">Modules this organization gets</label>
        <p class="help" style="margin-top:2px">Ticked from the plan's defaults — change any of them for this organization. Companies is always on.</p>
        <div class="mods">
          @for (m of grantable(); track m.key) {
            <label class="mod" [class.off]="!createMods[m.key]"><input type="checkbox" [checked]="createMods[m.key]" (change)="createMods[m.key] = !createMods[m.key]" /> {{ m.name }}</label>
          }
        </div>
        @if (createError()) { <div class="msg error">{{ createError() }}</div> }
        <div class="actions">
          <button class="btn gold" (click)="createOrg()" [disabled]="creating()">{{ creating() ? 'Creating…' : 'Create organization' }}</button>
        </div>
      </div>

      <app-pricing-admin (saved)="refresh()" />

      <div class="panel">
        <h2>Billing</h2>
        @if (billing(); as b) {
          <div class="msg info">{{ b.message }}</div>
        }
      </div>

      <div class="panel">
        <h2>Workspaces</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Workspace</th><th>Owner</th><th>Users</th><th>Plan</th><th>Expiry</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>
              @for (t of tenants(); track t.id) {
                <tr>
                  <td><strong>{{ t.name }}</strong><div class="muted">{{ t.slug }}</div></td>
                  <td>{{ t.ownerEmail ?? '—' }}</td>
                  <td>{{ t.userCount }}</td>
                  <td><span class="tag gold">{{ t.plan }}</span></td>
                  <td>
                    @switch (t.planState?.state) {
                      @case ('EXPIRING_SOON') { <span class="tag st-soon">{{ t.planState.daysLeft === 0 ? 'Expires today' : 'In ' + t.planState.daysLeft + ' day(s)' }}</span> }
                      @case ('GRACE') { <span class="tag st-grace">Grace until {{ t.planState.graceEndsOn }}</span> }
                      @case ('EXPIRED') { <span class="tag st-exp">Expired → FREE</span> }
                      @case ('ACTIVE') { <span class="muted">{{ t.planState.expiresOn ?? 'No end date' }}</span> }
                      @default { <span class="muted">No plan — all open</span> }
                    }
                  </td>
                  <td>
                    <span class="tag" [class.green]="t.isActive" [class.red]="!t.isActive">{{ t.isActive ? 'Active' : 'Paused' }}</span>
                  </td>
                  <td>{{ t.createdAt | date: 'yyyy-MM-dd' }}</td>
                  <td class="row-actions">
                    <button class="btn light small" (click)="openTenant(t.id)">{{ selectedId() === t.id ? 'Close' : 'Manage' }}</button>
                  </td>
                </tr>
              }
              @if (!tenants().length) { <tr><td colspan="7" class="empty">No workspaces yet.</td></tr> }
            </tbody>
          </table>
        </div>
      </div>

      @if (selected(); as d) {
        <div class="panel">
          <h2>{{ d.tenant.name }}</h2>
          <div class="actions" style="margin-top:0">
            <button class="btn light" (click)="toggleActive(d.tenant)">{{ d.tenant.isActive ? 'Pause this workspace' : 'Reactivate this workspace' }}</button>
          </div>

          <h3 style="margin-top:18px">Users</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>
                @for (u of d.users; track u.id) {
                  <tr><td>{{ u.email }}</td><td>{{ u.fullName }}</td><td>{{ u.role }}</td><td>{{ u.status }}</td></tr>
                }
              </tbody>
            </table>
          </div>

          <h3 style="margin-top:18px">Modules for this workspace</h3>
          <p class="help">
            @if (d.modules?.custom) { <strong>Chosen by Super Admin</strong> (overrides the {{ d.modules?.plan ?? 'plan' }} defaults). }
            @else if (d.modules?.plan) { Using the <strong>{{ d.modules.plan }}</strong> plan's default modules. }
            @else { No plan recorded yet — <strong>every module is open</strong>, as before plans existed. }
            The workspace Owner can switch these off for their team, but can never switch on a module that isn't ticked here.
          </p>
          <div class="mods">
            @for (m of grantable(); track m.key) {
              <label class="mod" [class.off]="!wsMods[m.key]"><input type="checkbox" [checked]="wsMods[m.key]" (change)="wsMods[m.key] = !wsMods[m.key]" /> {{ m.name }}</label>
            }
          </div>
          <div class="actions">
            <button class="btn gold" (click)="saveModules(d.tenant.id)" [disabled]="savingMods()">{{ savingMods() ? 'Saving…' : 'Save modules for this workspace' }}</button>
            <button class="btn light" (click)="resetModules(d.tenant.id)" [disabled]="savingMods() || !d.modules?.custom">Reset to plan default</button>
          </div>
          @if (modsMsg()) { <div class="msg info" style="margin-top:8px">{{ modsMsg() }}</div> }

          <h3 style="margin-top:18px">Plan history</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Status</th><th>Since</th><th>Expires</th><th>Billing</th><th>Promo</th><th>Payment</th><th class="num">Amount (NPR)</th></tr></thead>
              <tbody>
                @for (s of d.subscriptions; track s.id) {
                  <tr>
                    <td>{{ s.plan }}</td><td>{{ s.status }}</td><td>{{ s.createdAt | date: 'yyyy-MM-dd' }}</td>
                    <td>{{ s.expiresAt ? (s.expiresAt | date: 'yyyy-MM-dd') : '—' }}</td>
                    <td>{{ s.billingPeriod ? (s.billingPeriod | lowercase) : '—' }}</td>
                    <td>@if (s.promoCode) { <span class="tag gold">{{ s.promoCode }}</span> <span class="muted">−{{ +s.discountNPR | number: '1.0-0' }} of {{ +s.listPriceNPR | number: '1.0-0' }}</span> } @else { — }</td>
                    <td>{{ s.paymentMethod ?? '—' }} <span class="muted">{{ s.paymentRef }}</span></td>
                    <td class="num">{{ s.amountNPR != null ? (+s.amountNPR | number: '1.0-0') : '—' }}</td>
                  </tr>
                }
                @if (!d.subscriptions.length) { <tr><td colspan="8" class="empty">No plan recorded yet — every module is open until you set one.</td></tr> }
              </tbody>
            </table>
          </div>

          <h3 style="margin-top:18px">Set plan</h3>
          <p class="help">Records the plan (and, if applicable, a manually confirmed payment — nothing is collected here). Choosing a plan ticks its default modules below; adjust them if this customer's deal is different.</p>
          <div class="grid">
            <div>
              <label>Plan</label>
              <select [ngModel]="planForm.plan" (ngModelChange)="planForm.plan = $event; planMods = presetMap($event)">
                @for (p of planNames; track p) { <option [value]="p">{{ p }}</option> }
              </select>
            </div>
            <div>
              <label>Status</label>
              <select [(ngModel)]="planForm.status">
                <option value="ACTIVE">ACTIVE</option>
                <option value="TRIALING">TRIALING</option>
                <option value="PAST_DUE">PAST_DUE</option>
                <option value="CANCELED">CANCELED</option>
                <option value="EXPIRED">EXPIRED</option>
              </select>
            </div>
            <div>
              <label>Expires on <span class="muted">(Nepal date)</span></label>
              <input type="date" [(ngModel)]="planForm.expiresAt" />
              <div class="muted" style="font-size:12px;margin-top:4px">Valid through 23:59 that day, then a 7-day grace period before it drops to FREE modules. Empty = no end date.</div>
            </div>
            <div>
              <label>Billing period</label>
              <select [(ngModel)]="planForm.billingPeriod" (ngModelChange)="quote.set(null); suggestExpiry($event)">
                <option value="">— don't price automatically —</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>
            <div>
              <label>Promo code (optional)</label>
              <input [(ngModel)]="planForm.promoCode" (ngModelChange)="quote.set(null)" placeholder="e.g. FESTIVAL20" style="text-transform:uppercase" />
            </div>
            <div>
              <label>Amount paid (NPR)</label>
              <div style="display:flex;gap:6px">
                <input type="number" [(ngModel)]="planForm.amountNPR" />
                <button class="btn light small" (click)="calcPrice()" [disabled]="!planForm.billingPeriod">Calculate</button>
              </div>
            </div>
            <div>
              <label>Payment method</label>
              <input [(ngModel)]="planForm.paymentMethod" placeholder="e.g. Bank transfer, Cheque" />
            </div>
            <div>
              <label>Payment reference</label>
              <input [(ngModel)]="planForm.paymentRef" placeholder="e.g. transaction / cheque no." />
            </div>
          </div>
          <label style="margin-top:12px" class="inline"><input type="checkbox" [(ngModel)]="planApplyMods" /> Also set this workspace's modules to:</label>
          @if (planApplyMods) {
            <div class="mods">
              @for (m of grantable(); track m.key) {
                <label class="mod" [class.off]="!planMods[m.key]"><input type="checkbox" [checked]="planMods[m.key]" (change)="planMods[m.key] = !planMods[m.key]" /> {{ m.name }}</label>
              }
            </div>
          } @else {
            <p class="help">Modules stay as they are now (see "Modules for this workspace" above).</p>
          }
          <div class="actions">
            <button class="btn gold" (click)="savePlan(d.tenant.id)" [disabled]="savingPlan()">{{ savingPlan() ? 'Saving…' : 'Save plan' }}</button>
          </div>
          @if (quote(); as q) {
            <div class="msg" [class.error]="q.promoError" [class.info]="!q.promoError" style="margin-top:8px">
              List NPR {{ lakh(q.listPriceNPR) }}
              @if (q.promo) { − {{ q.promo.code }} ({{ q.promo.label }}) NPR {{ lakh(q.discountNPR) }} }
              = <strong>NPR {{ lakh(q.finalNPR) }}</strong>
              @if (q.promoError) { — {{ q.promoError }} }
            </div>
          }
          @if (planMsg()) { <div class="msg info" style="margin-top:8px">{{ planMsg() }}</div> }
        </div>
      }
    }
  `,
  styles: [UI_STYLES, `
    .stat { background: #f8f9fa; border-radius: 8px; padding: 12px 14px; }
    .stat span { display: block; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; }
    .stat strong { font-size: 22px; color: #0a1f3d; }
    .tag.st-soon { background: #fef3c7; color: #92400e; }
    .tag.st-grace { background: #ffedd5; color: #9a3412; }
    .tag.st-exp { background: #fee2e2; color: #991b1b; }
    .plan-counts { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
    .muted { color: #9ca3af; font-size: 12px; }
    .tag.green { background: #dcfce7; color: #15803d; }
    .tag.red { background: #fee2e2; color: #b91c1c; }
    .btn.small { padding: 6px 12px; font-size: 13px; }
    .row-actions { white-space: nowrap; }
    .link-panel { border-left: 4px solid #d4a017; }
    .linkbox { display: flex; align-items: center; gap: 10px; background: #f8f9fa; border-radius: 8px; padding: 10px 14px; flex-wrap: wrap; }
    .linkbox code { word-break: break-all; font-size: 13px; }
    .mods { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin: 8px 0; }
    .mod { display: flex; gap: 8px; align-items: center; border: 1px solid #e1e3e6; border-radius: 8px; padding: 10px 12px; font-weight: 600; color: #0a1f3d; margin: 0; cursor: pointer; }
    .mod input { width: auto; }
    .mod.off { background: #f9fafb; color: #9ca3af; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; font-weight: 600; }
    label.inline input { width: auto; }
  `],
})
export class AdminPage {
  private auth = inject(AuthService);
  private data = inject(DataService);
  jobBusy = signal(false);
  jobMsg = signal('');
  async runDigest() {
    this.jobBusy.set(true); this.jobMsg.set('');
    try {
      const r = await this.data.adminRunDigest();
      this.jobMsg.set(r.emailEnabled ? `✅ Sent ${r.emails} email(s) to ${r.workspaces} workspace(s) (${r.alerts} alert(s)).` : `Email isn't switched on yet (BREVO_API_KEY / domain). ${r.workspaces} workspace(s) have alerts today.`);
    } catch (e) { this.jobMsg.set(errorText(e)); }
    this.jobBusy.set(false);
  }
  async resetDemo() {
    this.jobBusy.set(true); this.jobMsg.set('');
    try { await this.data.adminResetDemo(); this.jobMsg.set('✅ Demo workspace rebuilt with fresh sample data.'); } catch (e) { this.jobMsg.set(errorText(e)); }
    this.jobBusy.set(false);
  }

  isSuperAdmin = signal(this.auth.getUser()?.role === 'SUPER_ADMIN');
  error = signal('');
  tenants = signal<any[]>([]);
  stats = signal<any | null>(null);
  billing = signal<any | null>(null);
  selectedId = signal<string | null>(null);
  selected = signal<any | null>(null);
  planForm = { plan: 'FREE', status: 'ACTIVE', expiresAt: '', amountNPR: null as number | null, paymentMethod: '', paymentRef: '', billingPeriod: '', promoCode: '' };
  quote = signal<any | null>(null);
  lakh(n: number) { return Number(n ?? 0).toLocaleString('en-IN'); }
  /** Picking Monthly / Yearly fills the expiry (today + 1 month / 1 year, Nepal Time) if it's empty. */
  suggestExpiry(period: string) {
    if (this.planForm.expiresAt || !period) return;
    const d = new Date(nptToday() + 'T00:00:00Z');
    if (period === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
    this.planForm.expiresAt = d.toISOString().slice(0, 10);
  }

  creating = signal(false);
  createError = signal('');
  createdLink = signal<string | null>(null);
  createdEmailed = signal(false);
  createdTenantName = signal('');
  copied = signal(false);
  createForm = { tenantName: '', ownerName: '', ownerEmail: '', ownerPhone: '', plan: 'FREE' };

  // ---- module choice (Super Admin picks the exact modules per workspace) ----
  readonly planNames = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];
  /** { modules: [{key,name,core}], presets: { FREE: [...], ... } } from GET /admin/plans */
  planInfo = signal<{ modules: { key: string; name: string; core: boolean }[]; presets: Record<string, string[]> } | null>(null);
  grantable = computed(() => (this.planInfo()?.modules ?? []).filter((m) => !m.core));
  createMods: Record<string, boolean> = {};
  wsMods: Record<string, boolean> = {};
  planMods: Record<string, boolean> = {};
  planApplyMods = true;
  savingMods = signal(false);
  savingPlan = signal(false);
  modsMsg = signal('');
  planMsg = signal('');

  /** { bolpatra: true, fleet: false, … } with a plan's default modules ticked. */
  presetMap(plan: string): Record<string, boolean> {
    const preset = this.planInfo()?.presets?.[plan] ?? [];
    return Object.fromEntries(this.grantable().map((m) => [m.key, preset.includes(m.key)]));
  }
  private ticked(map: Record<string, boolean>): string[] {
    return this.grantable().filter((m) => map[m.key]).map((m) => m.key);
  }

  planKeys(m: Record<string, number>): string[] { return Object.keys(m ?? {}); }

  constructor() {
    if (!this.isSuperAdmin()) return;
    this.refresh();
  }

  async refresh() {
    try {
      const [tenants, stats, billing, plans] = await Promise.all([
        this.data.adminTenants(), this.data.adminStats(), this.data.adminBilling(), this.data.adminPlans(),
      ]);
      this.tenants.set(tenants);
      this.stats.set(stats);
      this.billing.set(billing);
      const first = !this.planInfo();
      this.planInfo.set(plans);
      if (first) this.createMods = this.presetMap(this.createForm.plan);
    } catch (e: any) {
      this.error.set('Could not load the admin panel: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
  }

  /** Toggles the detail panel open/closed for a row in the table. */
  async openTenant(id: string) {
    if (this.selectedId() === id) { this.selectedId.set(null); this.selected.set(null); return; }
    this.selectedId.set(id);
    await this.loadTenant(id);
  }

  /** Re-fetches one workspace's detail without toggling it closed — used after an action on it. */
  private async loadTenant(id: string) {
    try {
      const d = await this.data.adminTenant(id);
      this.selected.set(d);
      const current = d.modules?.plan ?? 'FREE';
      this.planForm = { plan: current, status: 'ACTIVE', expiresAt: '', amountNPR: null, paymentMethod: '', paymentRef: '', billingPeriod: '', promoCode: '' };
      this.quote.set(null);
      const unlocked: string[] | null = d.modules?.unlockedModules ?? null; // null = no plan yet, everything open
      this.wsMods = Object.fromEntries(this.grantable().map((m) => [m.key, unlocked === null || unlocked.includes(m.key)]));
      this.planMods = this.presetMap(current);
      this.planApplyMods = true;
    } catch (e: any) {
      this.error.set('Could not open this workspace: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
  }

  async createOrg() {
    this.createError.set('');
    const f = this.createForm;
    if (!f.tenantName.trim() || !f.ownerName.trim() || !f.ownerEmail.trim()) {
      this.createError.set('Organization name, owner name and owner email are all required.');
      return;
    }
    this.creating.set(true);
    try {
      const body: any = { tenantName: f.tenantName.trim(), ownerName: f.ownerName.trim(), ownerEmail: f.ownerEmail.trim(), plan: f.plan };
      if (f.ownerPhone.trim()) body.ownerPhone = f.ownerPhone.trim();
      if (this.grantable().length) body.modules = this.ticked(this.createMods);
      const res = await this.data.adminCreateTenant(body);
      this.createdLink.set(res.ownerActivationLink);
      this.createdEmailed.set(!!res.emailed);
      this.createdTenantName.set(res.tenant?.name ?? f.tenantName);
      this.createForm = { tenantName: '', ownerName: '', ownerEmail: '', ownerPhone: '', plan: 'FREE' };
      this.createMods = this.presetMap('FREE');
      await this.refresh();
    } catch (e: any) {
      this.createError.set('Could not create the organization: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
    this.creating.set(false);
  }

  fullLink(path: string) { return `${location.origin}${path}`; }
  async copyLink(path: string) {
    try { await navigator.clipboard.writeText(this.fullLink(path)); this.copied.set(true); setTimeout(() => this.copied.set(false), 2500); } catch { /* clipboard blocked */ }
  }

  async toggleActive(tenant: any) {
    await this.data.adminToggleActive(tenant.id, !tenant.isActive);
    await this.refresh();
    if (this.selectedId()) await this.loadTenant(this.selectedId()!);
  }

  async savePlan(tenantId: string) {
    const body: any = { ...this.planForm };
    if (!body.expiresAt) delete body.expiresAt;
    if (body.amountNPR === null || body.amountNPR === '') delete body.amountNPR;
    if (!body.paymentMethod) delete body.paymentMethod;
    if (!body.paymentRef) delete body.paymentRef;
    if (!body.billingPeriod) delete body.billingPeriod;
    body.promoCode = (body.promoCode || '').trim().toUpperCase();
    if (!body.promoCode) delete body.promoCode;
    if (this.planApplyMods && this.grantable().length) body.modules = this.ticked(this.planMods);
    this.savingPlan.set(true); this.planMsg.set(''); this.error.set('');
    try {
      await this.data.adminSetPlan(tenantId, body);
      await this.refresh();
      await this.loadTenant(tenantId);
      this.planMsg.set(`✅ Plan ${body.plan} saved${body.modules ? ' with the ticked modules' : ''}.`);
    } catch (e: any) {
      this.error.set('Could not save the plan: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
    this.savingPlan.set(false);
  }

  /** Price for the chosen plan + period (+ promo) from the pricing catalog; fills "Amount paid". */
  async calcPrice() {
    const f = this.planForm;
    if (!f.billingPeriod) return;
    try {
      const q = await this.data.adminQuote({ plan: f.plan, period: f.billingPeriod, code: (f.promoCode || '').trim() || undefined });
      this.quote.set(q);
      if (!q.promoError) f.amountNPR = q.finalNPR;
    } catch (e: any) {
      this.error.set('Could not calculate the price: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
  }

  /** Super Admin's exact module choice for one workspace (overrides its plan's defaults). */
  async saveModules(tenantId: string) {
    this.savingMods.set(true); this.modsMsg.set(''); this.error.set('');
    try {
      await this.data.adminSetModules(tenantId, { modules: this.ticked(this.wsMods) });
      await this.loadTenant(tenantId);
      this.modsMsg.set("✅ Saved. The workspace's users see the change after they refresh the page (no sign-out needed).");
    } catch (e: any) {
      this.error.set('Could not save modules: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
    this.savingMods.set(false);
  }

  async resetModules(tenantId: string) {
    this.savingMods.set(true); this.modsMsg.set(''); this.error.set('');
    try {
      await this.data.adminSetModules(tenantId, { usePlanDefault: true });
      await this.loadTenant(tenantId);
      this.modsMsg.set("✅ Back to the plan's default modules.");
    } catch (e: any) {
      this.error.set('Could not reset modules: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
    this.savingMods.set(false);
  }
}
