// Platform admin panel — Super Admin only. Lists every workspace on the platform (not just the
// signed-in person's own one), lets Super Admin record a plan / payment manually, pause a
// workspace, and shows honest platform-wide numbers. Billing is a labelled placeholder until
// eSewa / Khalti merchant credentials exist. © Cuidado Technology Pvt. Ltd.
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { DataService } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>🛡️ Admin Panel</h1>
    <p class="sub">Platform-wide — every workspace on ProcureNepal, not just your own.</p>

    @if (!isSuperAdmin()) {
      <div class="msg error">This page is for platform Super Admins only. If you believe you should have access, ask whoever manages the ProcureNepal platform account.</div>
    } @else {
      @if (error()) { <div class="msg error">{{ error() }}</div> }

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
          </div>
        } @else {
          <p class="help">Loading…</p>
        }
      </div>

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
            <thead><tr><th>Workspace</th><th>Owner</th><th>Users</th><th>Plan</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>
              @for (t of tenants(); track t.id) {
                <tr>
                  <td><strong>{{ t.name }}</strong><div class="muted">{{ t.slug }}</div></td>
                  <td>{{ t.ownerEmail ?? '—' }}</td>
                  <td>{{ t.userCount }}</td>
                  <td><span class="tag gold">{{ t.plan }}</span></td>
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

          <h3 style="margin-top:18px">Plan history</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Status</th><th>Since</th><th>Expires</th><th>Payment</th><th>Amount (NPR)</th></tr></thead>
              <tbody>
                @for (s of d.subscriptions; track s.id) {
                  <tr>
                    <td>{{ s.plan }}</td><td>{{ s.status }}</td><td>{{ s.createdAt | date: 'yyyy-MM-dd' }}</td>
                    <td>{{ s.expiresAt ? (s.expiresAt | date: 'yyyy-MM-dd') : '—' }}</td>
                    <td>{{ s.paymentMethod ?? '—' }} <span class="muted">{{ s.paymentRef }}</span></td>
                    <td class="num">{{ s.amountNPR ?? '—' }}</td>
                  </tr>
                }
                @if (!d.subscriptions.length) { <tr><td colspan="6" class="empty">No plan recorded yet — defaults to FREE.</td></tr> }
              </tbody>
            </table>
          </div>

          <h3 style="margin-top:18px">Set plan</h3>
          <p class="help">This only labels the workspace — it does not switch any module on or off by itself, and no payment is collected here. Record it after you've agreed a plan (and, if applicable, confirmed a manual payment) with the customer.</p>
          <div class="grid">
            <div>
              <label>Plan</label>
              <select [(ngModel)]="planForm.plan">
                <option value="FREE">FREE</option>
                <option value="STARTER">STARTER</option>
                <option value="PROFESSIONAL">PROFESSIONAL</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
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
              <label>Expires on</label>
              <input type="date" [(ngModel)]="planForm.expiresAt" />
            </div>
            <div>
              <label>Amount paid (NPR)</label>
              <input type="number" [(ngModel)]="planForm.amountNPR" />
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
          <div class="actions">
            <button class="btn gold" (click)="savePlan(d.tenant.id)">Save plan</button>
          </div>
        </div>
      }
    }
  `,
  styles: [UI_STYLES, `
    .stat { background: #f8f9fa; border-radius: 8px; padding: 12px 14px; }
    .stat span { display: block; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; }
    .stat strong { font-size: 22px; color: #0a1f3d; }
    .plan-counts { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
    .muted { color: #9ca3af; font-size: 12px; }
    .tag.green { background: #dcfce7; color: #15803d; }
    .tag.red { background: #fee2e2; color: #b91c1c; }
    .btn.small { padding: 6px 12px; font-size: 13px; }
    .row-actions { white-space: nowrap; }
  `],
})
export class AdminPage {
  private auth = inject(AuthService);
  private data = inject(DataService);

  isSuperAdmin = signal(this.auth.getUser()?.role === 'SUPER_ADMIN');
  error = signal('');
  tenants = signal<any[]>([]);
  stats = signal<any | null>(null);
  billing = signal<any | null>(null);
  selectedId = signal<string | null>(null);
  selected = signal<any | null>(null);
  planForm = { plan: 'FREE', status: 'ACTIVE', expiresAt: '', amountNPR: null as number | null, paymentMethod: '', paymentRef: '' };

  planKeys(m: Record<string, number>): string[] { return Object.keys(m ?? {}); }

  constructor() {
    if (!this.isSuperAdmin()) return;
    this.refresh();
  }

  async refresh() {
    try {
      const [tenants, stats, billing] = await Promise.all([this.data.adminTenants(), this.data.adminStats(), this.data.adminBilling()]);
      this.tenants.set(tenants);
      this.stats.set(stats);
      this.billing.set(billing);
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
      this.planForm = { plan: 'FREE', status: 'ACTIVE', expiresAt: '', amountNPR: null, paymentMethod: '', paymentRef: '' };
    } catch (e: any) {
      this.error.set('Could not open this workspace: ' + (e?.error?.message ?? e?.message ?? 'unknown error'));
    }
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
    await this.data.adminSetPlan(tenantId, body);
    await this.refresh();
    await this.loadTenant(tenantId);
  }
}
