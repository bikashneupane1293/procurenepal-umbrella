import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { AuthService } from '../../core/auth.service';
import { UI_STYLES } from '../../core/ui-styles';
import { DateField } from '../../shared/date-field';
import { ImportPanel } from '../../shared/import-panel';
import { PdfFill, PdfApply } from '../../shared/pdf-fill';
import { adToBs } from '../../core/nepali-date';
import type { SheetRow } from '../../core/sheets';

const loadSheets = () => import('../../core/bank-sheets');

export const GUARANTEE_TYPE_LABEL: Record<string, string> = {
  BID_SECURITY: 'Bid security', PERFORMANCE: 'Performance', ADVANCE_PAYMENT: 'Advance payment',
  RETENTION: 'Retention money', CUSTOMS: 'Customs', OTHER: 'Other',
};
export const GUARANTEE_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested', ACTIVE: 'Active', RELEASED: 'Released', EXPIRED: 'Expired', CLAIMED: 'Claimed (encashed)', CANCELLED: 'Cancelled',
};
const BASIS_LABEL: Record<string, string> = { QUARTER: 'per quarter', YEAR: 'per year', FLAT: 'once (flat)' };
const PDF_KIND: Record<string, string> = { BID: 'BID_SECURITY', PERFORMANCE: 'PERFORMANCE', ADVANCE: 'ADVANCE_PAYMENT', RETENTION: 'RETENTION' };
const DATE_KEYS = ['issueDate', 'expiryDate', 'claimExpiryDate', 'releaseDate'];
const NUM_KEYS = ['amount', 'marginPct', 'marginAmount', 'commissionPct', 'commissionAmount'];
const TEXT_KEYS = ['bankName', 'branch', 'guaranteeNo', 'beneficiary', 'purpose', 'commissionBasis', 'releaseRef', 'notes'];
const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Created', CREATED_FROM_BID: 'Created from the bid', SYNCED_FROM_BID: 'Updated from the bid', LINKED_TO_BID: 'Linked to the bid',
  EXTENDED: 'Extended', AMOUNT_AMENDED: 'Amount amended', UPDATED: 'Edited',
};

/** Same estimate as the server: rate × number of quarters / years (or part of one), or once. */
function estimate(amount: number, pct: number | null, basis: string, issue: string, expiry: string): number | null {
  if (!amount || pct === null || pct === undefined || isNaN(pct)) return null;
  let periods = 1;
  if (basis !== 'FLAT') {
    if (!issue || !expiry) return null;
    const days = Math.max(1, Math.ceil((new Date(expiry).getTime() - new Date(issue).getTime()) / 86400000));
    periods = Math.ceil(days / (basis === 'YEAR' ? 365 : 91));
  }
  return Math.round(amount * (pct / 100) * periods * 100) / 100;
}

@Component({
  selector: 'app-bank-guarantees',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, DateField, ImportPanel, PdfFill],
  template: `
    <div class="bar">
      <div>
        <h1>Bank Guarantee Management</h1>
        <p class="sub">Bid, performance, advance-payment and retention guarantees with expiry and release alerts. Bid and performance securities entered on a bid appear here automatically.</p>
      </div>
      <div class="tools">
        @if (list().length) { <button class="btn light" (click)="exportExcel()">⬇ Export Excel</button> }
        <button class="btn light" (click)="template()">📄 Excel Template</button>
        <button class="btn light" (click)="fileInput.click()">⬆ Import Excel</button>
        <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
        <button class="btn light" (click)="syncBids()" [disabled]="syncing()">{{ syncing() ? 'Checking bids…' : '↻ Bring in from bids' }}</button>
        @if (!showForm()) { <button class="btn gold" (click)="openNew()">+ New Guarantee</button> }
      </div>
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }
    @if (error()) { <div class="msg error">{{ error() }}</div> }

    @if (impRows().length || impError()) {
      <app-import-panel [rows]="impRows()" [headers]="['Company', 'Bank', 'Type', 'Guarantee No', 'Amount']" [fileName]="impFile()"
        [error]="impError()" [busy]="importing()" (run)="runImport()" (closed)="impRows.set([]); impError.set('')" />
    }

    <!-- Form -->
    @if (showForm()) {
      <form class="panel edit" (ngSubmit)="save()">
        <div class="bar tight">
          <h2>{{ cur() ? (typeLabel(cur().type) + ' — ' + (cur().guaranteeNo || 'no number yet')) : 'New guarantee' }}
            @if (cur()) { <span class="st" [class]="'st ' + cur().status">{{ statusLabel(cur().status) }}</span> }
            @if (cur()?.source === 'BID') { <span class="tag gold">from bid</span> }</h2>
          <button type="button" class="btn light small" (click)="close()">Close</button>
        </div>
        @if (cur(); as g) {
          @if (g.tender) { <p class="help">Tender {{ g.tender.ifbNumber }} — {{ g.tender.projectTitle }}
            @if (g.bidId) { · <a class="link" routerLink="/bids" [queryParams]="{ bid: g.bidId }">Open the bid →</a> }
            @if (g.project) { · <a class="link" [routerLink]="['/projects', g.project.id]">Project {{ g.project.code }} →</a> }
            · <a class="link" [routerLink]="['/tenders', g.tenderId]">Tender workspace →</a></p> }
          @for (a of g.alerts; track a.code) { <div class="msg" [class]="'msg ' + alertTone(a.code)">{{ alertIcon(a.code) }} {{ a.message }}</div> }
        }
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }

        <app-pdf-fill kind="guarantee" (filled)="fromPdf($event)" />

        <h3>1. Guarantee</h3>
        <div class="grid">
          <div><label>Type <span class="req">*</span></label>
            <select name="type" [(ngModel)]="f.type">@for (k of types; track k) { <option [value]="k">{{ typeLabel(k) }}</option> }</select></div>
          <div><label>Company (applicant) <span class="req">*</span></label>
            <select name="companyId" [(ngModel)]="f.companyId" (ngModelChange)="onCompany()" [disabled]="!!cur()?.bidId">
              <option value="">— Select company —</option>
              @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select></div>
          <div><label>Bank <span class="req">*</span></label>
            <select name="bankId" [(ngModel)]="f.bankId" (ngModelChange)="onBank()">
              <option value="">— Type the name below —</option>
              @for (b of companyBanks(); track b.id) { <option [value]="b.id">{{ b.name }}{{ b.branch ? ' (' + b.branch + ')' : '' }}</option> }
            </select>
            @if (f.companyId && !companyBanks().length) { <div class="help"><a class="link" routerLink="/banks">Add this company's banks →</a></div> }</div>
          @if (!f.bankId) {
            <div><label>Bank name</label><input name="bankName" [(ngModel)]="f.bankName" placeholder="e.g. Nabil Bank Limited" /></div>
          }
          <div><label>Branch</label><input name="branch" [(ngModel)]="f.branch" /></div>
          <div><label>Guarantee No.</label><input name="guaranteeNo" [(ngModel)]="f.guaranteeNo" placeholder="Blank while requested" /></div>
          <div><label>Amount (NPR) <span class="req">*</span></label><input type="number" min="1" name="amount" [(ngModel)]="f.amount" /></div>
          <div><label>Status</label>
            <select name="status" [(ngModel)]="f.status">@for (s of statuses; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }</select></div>
        </div>

        <h3>2. Linked to</h3>
        <div class="grid">
          <div><label>Bid (Bolpatra)</label>
            <select name="bidId" [(ngModel)]="f.bidId" (ngModelChange)="onBid()" [disabled]="!f.companyId">
              <option value="">— Not linked to a bid —</option>
              @for (b of companyBids(); track b.id) { <option [value]="b.id">{{ b.tender?.ifbNumber }} — {{ b.tender?.projectTitle }}</option> }
            </select>
            <div class="help">A linked bid shows the same bank, number, amount and expiry.</div></div>
          @if (!f.bidId) {
            <div><label>Tender</label>
              <select name="tenderId" [(ngModel)]="f.tenderId" (ngModelChange)="onTender()">
                <option value="">— None —</option>
                @for (t of tenders(); track t.id) { <option [value]="t.id">{{ t.ifbNumber }} — {{ t.projectTitle }}</option> }
              </select></div>
          }
          @if (!f.bidId && projects().length) {
            <div><label>Project</label>
              <select name="projectId" [(ngModel)]="f.projectId" (ngModelChange)="onProject()">
                <option value="">— None —</option>
                @for (x of companyProjects(); track x.id) { <option [value]="x.id">{{ x.code }} — {{ x.name }}</option> }
              </select></div>
          }
          <div><label>Beneficiary (procuring entity)</label><input name="beneficiary" [(ngModel)]="f.beneficiary" /></div>
          <div><label>Purpose</label><input name="purpose" [(ngModel)]="f.purpose" placeholder="e.g. Mobilisation advance 10%" /></div>
        </div>

        <h3>3. Dates</h3>
        <div class="grid">
          <app-date-field label="Issue date" [(value)]="f.issueDate" />
          <app-date-field label="Valid until (expiry)" [(value)]="f.expiryDate" />
          <app-date-field label="Claim expiry (if different)" [(value)]="f.claimExpiryDate" />
        </div>

        <h3>4. Bank charges (estimate)</h3>
        <div class="grid">
          <div><label>Margin %</label><input type="number" min="0" max="100" step="0.01" name="marginPct" [(ngModel)]="f.marginPct" /></div>
          <div><label>Margin amount (NPR)</label><input type="number" min="0" name="marginAmount" [(ngModel)]="f.marginAmount" [placeholder]="marginHint()" />
            <div class="help">Blank = amount × margin %</div></div>
          <div><label>Commission %</label><input type="number" min="0" max="100" step="0.001" name="commissionPct" [(ngModel)]="f.commissionPct" /></div>
          <div><label>Commission charged</label>
            <select name="commissionBasis" [(ngModel)]="f.commissionBasis">
              <option value="">—</option>
              @for (k of bases; track k) { <option [value]="k">{{ basisLabel(k) }}</option> }
            </select></div>
          <div><label>Commission amount (NPR)</label><input type="number" min="0" name="commissionAmount" [(ngModel)]="f.commissionAmount" [placeholder]="commissionHint()" />
            <div class="help">Blank = calculated (per quarter / year or part of it)</div></div>
        </div>

        @if (f.status === 'RELEASED' || f.status === 'CLAIMED' || f.releaseDate) {
          <h3>5. Release / closure</h3>
          <div class="grid">
            <app-date-field label="Released / returned on" [(value)]="f.releaseDate" />
            <div><label>Release letter / reference</label><input name="releaseRef" [(ngModel)]="f.releaseRef" /></div>
          </div>
        }

        <label>Notes</label>
        <textarea name="notes" [(ngModel)]="f.notes" rows="2"></textarea>

        @if (cur()?.history?.length) {
          <div class="history">History:
            @for (h of cur().history; track $index) { <span class="tag">{{ actionLabel(h.action) }} · {{ bs(h.at) }}</span> }
          </div>
        }

        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save guarantee' }}</button>
          @if (cur() && open(cur().status)) {
            <button class="btn light" type="button" (click)="markReleased()">✔ Mark released (returned by the beneficiary)</button>
          }
          @if (cur() && canDelete) { <button class="btn danger" type="button" (click)="confirmDel.set(true)">Delete</button> }
        </div>
        @if (confirmDel()) {
          <div class="msg error">Delete this guarantee record? Usually it is better to mark it Released or Cancelled. This cannot be undone.
            <button type="button" class="btn danger small" (click)="remove()">Delete permanently</button>
            <button type="button" class="btn light small" (click)="confirmDel.set(false)">Cancel</button>
          </div>
        }
      </form>
    }

    <!-- Summary -->
    @if (sum(); as s) {
      <section class="cards">
        <div class="card"><div class="label">Open guarantees</div><div class="value">{{ s.open.count }}</div><div class="hint">Rs {{ s.open.amount | number: '1.0-0' }}</div></div>
        <div class="card"><div class="label">Margin held by banks</div><div class="value small">Rs {{ s.open.marginHeld | number: '1.0-0' }}</div><div class="hint">Commission (est.) Rs {{ s.open.commission | number: '1.0-0' }}</div></div>
        <div class="card"><div class="label">Expiring in {{ s.windowDays }} days</div><div class="value" [class.warn]="s.expiring.length">{{ s.expiring.length }}</div><div class="hint">extend or get released</div></div>
        <div class="card"><div class="label">Release due</div><div class="value" [class.warn]="s.releaseDue.length">{{ s.releaseDue.length }}</div><div class="hint">collect from the beneficiary</div></div>
        <div class="card"><div class="label">Expired, still open</div><div class="value" [class.bad]="s.expiredOpen.length">{{ s.expiredOpen.length }}</div><div class="hint">needs release letter or extension</div></div>
      </section>

      @if (alertRows().length) {
        <section class="panel">
          <h2>Needs attention</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>What</th><th>Guarantee</th><th>Company</th><th>Expiry</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>
              @for (r of alertRows(); track r.key) {
                <tr>
                  <td><span class="al" [class]="'al ' + alertTone(r.code)">{{ alertIcon(r.code) }} {{ r.message }}</span></td>
                  <td>{{ typeLabel(r.g.type) }} · {{ r.g.guaranteeNo || 'no number' }}<div class="help">{{ r.g.bankName }}@if (r.g.tender) { · {{ r.g.tender.ifbNumber }} }</div></td>
                  <td>{{ r.g.company?.name }}</td>
                  <td>{{ r.g.expiryDate ? bs(r.g.expiryDate) : '—' }}</td>
                  <td class="num">{{ num(r.g.amount) | number: '1.0-0' }}</td>
                  <td><button class="btn light small" (click)="openById(r.g.id)">Open</button></td>
                </tr>
              }
            </tbody>
          </table></div>
        </section>
      }

      @if (s.perBank.length) {
        <section class="panel">
          <h2>Limit use per bank</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Bank</th><th>Company</th><th class="num">Open BGs</th><th class="num">Used (NPR)</th><th class="num">Limit</th><th class="num">Available</th><th>Use</th></tr></thead>
            <tbody>
              @for (b of s.perBank; track $index) {
                <tr>
                  <td><strong>{{ b.bank }}</strong>@if (b.branch) { <div class="help">{{ b.branch }}</div> }@if (!b.bankId) { <div class="help">not in the bank list</div> }</td>
                  <td>{{ b.company }}</td>
                  <td class="num">{{ b.count }}</td>
                  <td class="num">{{ b.used | number: '1.0-0' }}</td>
                  <td class="num">{{ b.limit != null ? (b.limit | number: '1.0-0') : '—' }}</td>
                  <td class="num" [class.badtxt]="b.available != null && b.available < 0">{{ b.available != null ? (b.available | number: '1.0-0') : '—' }}</td>
                  <td>@if (b.usedPct != null) { <div class="meter"><span [style.width.%]="min100(b.usedPct)" [class.hi]="b.usedPct >= 80" [class.over]="b.usedPct > 100"></span></div><span class="help">{{ b.usedPct }}%</span> }</td>
                </tr>
              }
            </tbody>
          </table></div>
          @if (s.overLimit.length) { <div class="msg error">Over the guarantee limit: {{ s.overLimit.join(', ') }}. Ask the bank for a higher limit before the next bid.</div> }
          <p class="help"><a class="link" routerLink="/banks">Manage banks and limits →</a></p>
        </section>
      }
    }

    <!-- List -->
    <div class="panel">
      <div class="filters">
        <select name="fs" [ngModel]="fStatus()" (ngModelChange)="fStatus.set($event)">
          <option value="OPEN">Open (requested + active)</option>
          <option value="">All statuses</option>
          @for (s of statuses; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
        </select>
        <select name="ft" [ngModel]="fType()" (ngModelChange)="fType.set($event)">
          <option value="">All types</option>
          @for (k of types; track k) { <option [value]="k">{{ typeLabel(k) }}</option> }
        </select>
        <select name="fc" [ngModel]="fCompany()" (ngModelChange)="fCompany.set($event)">
          <option value="">All companies</option>
          @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
        <select name="fb" [ngModel]="fBank()" (ngModelChange)="fBank.set($event)">
          <option value="">All banks</option>
          @for (b of banks(); track b.id) { <option [value]="b.id">{{ b.name }}{{ b.branch ? ' (' + b.branch + ')' : '' }}</option> }
        </select>
        <input name="fq" placeholder="Search number / IFB / beneficiary" [ngModel]="fText()" (ngModelChange)="fText.set($event)" />
        <label class="inline">Alerts for <select name="days" [ngModel]="days()" (ngModelChange)="setDays($event)">
          @for (d of [15, 30, 60, 90]; track d) { <option [ngValue]="d">{{ d }} days</option> }
        </select></label>
      </div>
      @if (loading()) { <div class="msg info">Loading guarantees…</div> }
      @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Guarantee / bank</th><th>Company</th><th>Tender / beneficiary</th><th class="num">Amount (NPR)</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (g of filtered(); track g.id) {
                <tr [class.sel]="cur()?.id === g.id">
                  <td>{{ typeLabel(g.type) }}@if (g.source === 'BID') { <div class="help">from bid</div> }</td>
                  <td><strong>{{ g.guaranteeNo || '—' }}</strong><div class="help">{{ g.bankName }}{{ g.branch ? ', ' + g.branch : '' }}</div></td>
                  <td>{{ g.company?.name }}</td>
                  <td>{{ g.tender?.ifbNumber || '—' }}@if (g.project) { <span class="tag">{{ g.project.code }}</span> }<div class="help">{{ g.beneficiary }}</div></td>
                  <td class="num">{{ num(g.amount) | number: '1.0-0' }}</td>
                  <td>@if (g.expiryDate) { {{ bs(g.expiryDate) }} @if (open(g.status)) { <span class="days" [class.warn]="g.daysLeft <= 15">{{ daysText(g.daysLeft) }}</span> } } @else { — }</td>
                  <td><span class="st" [class]="'st ' + g.status">{{ statusLabel(g.status) }}</span>
                    @for (a of g.alerts; track a.code) { <span class="dot" [class]="'dot ' + alertTone(a.code)" [title]="a.message">{{ alertIcon(a.code) }}</span> }</td>
                  <td><button class="btn light small" (click)="openById(g.id)">Open</button></td>
                </tr>
              } @empty { <tr><td colspan="8" class="empty">No guarantees here. Enter a bank-guarantee bid security on a bid, click <strong>↻ Bring in from bids</strong>, or click <strong>+ New Guarantee</strong>.</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [UI_STYLES, `
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 22px 0 10px; padding-top: 14px; border-top: 1px solid #eef0f2; }
    .bar.tight { margin-bottom: 4px; align-items: center; }
    .bar.tight h2 { margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn.small { padding: 6px 12px; }
    textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 16px; }
    .card .label { color: #4b5563; font-size: 13px; }
    .card .value { font-size: 28px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .card .value.small { font-size: 18px; }
    .card .value.warn { color: #b8860b; }
    .card .value.bad { color: #b91c1c; }
    .card .hint { font-size: 12px; color: #9ca3af; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
    .filters select, .filters input { width: auto; min-width: 160px; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; margin: 0; font-weight: 600; }
    label.inline select { min-width: 0; }
    .st { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 10px; background: #e8eef6; color: #1e3a5f; white-space: nowrap; }
    .st.ACTIVE { background: #dcfce7; color: #15803d; }
    .st.REQUESTED { background: #fef5e0; color: #8a6508; }
    .st.CLAIMED, .st.EXPIRED { background: #fee2e2; color: #b91c1c; }
    .st.RELEASED, .st.CANCELLED { background: #f3f4f6; color: #6b7280; }
    .dot { margin-left: 4px; cursor: help; }
    .al { font-size: 13px; }
    .al.bad { color: #b91c1c; } .al.warn { color: #8a6508; } .al.info { color: #1e3a5f; }
    .msg.warn { background: #fef5e0; border: 1px solid #f5d98a; color: #6b4e06; }
    .msg.bad { background: #fef2f2; border: 1px solid #fecaca; color: #7f1d1d; }
    .days { font-size: 11px; color: #6b7280; display: block; }
    .days.warn { color: #b91c1c; font-weight: 700; }
    .meter { width: 100px; height: 8px; background: #eef0f2; border-radius: 4px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px; }
    .meter span { display: block; height: 100%; background: #1e3a5f; }
    .meter span.hi { background: #d4a017; }
    .meter span.over { background: #b91c1c; }
    td.badtxt { color: #b91c1c; font-weight: 700; }
    .history { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; margin-top: 12px; }
    tr.sel td { background: #fffbeb; }
  `],
})
export class BankGuaranteesPage {
  private data = inject(DataService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  canDelete = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'].includes(this.auth.getUser()?.role);
  types = Object.keys(GUARANTEE_TYPE_LABEL);
  statuses = Object.keys(GUARANTEE_STATUS_LABEL);
  bases = Object.keys(BASIS_LABEL);

  list = signal<any[]>([]);
  sum = signal<any | null>(null);
  companies = signal<any[]>([]);
  banks = signal<any[]>([]);
  bids = signal<any[]>([]);
  tenders = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  okMsg = signal('');
  formError = signal('');
  saving = signal(false);
  syncing = signal(false);
  showForm = signal(false);
  cur = signal<any | null>(null);
  confirmDel = signal(false);
  days = signal(30);
  fStatus = signal('OPEN');
  fType = signal('');
  fCompany = signal('');
  fBank = signal('');
  fText = signal('');
  f: any = {};

  filtered = computed(() => {
    const q = this.fText().trim().toLowerCase();
    return this.list().filter((g) =>
      (!this.fStatus() || (this.fStatus() === 'OPEN' ? this.open(g.status) : g.status === this.fStatus())) &&
      (!this.fType() || g.type === this.fType()) &&
      (!this.fCompany() || g.companyId === this.fCompany()) &&
      (!this.fBank() || g.bankId === this.fBank()) &&
      (!q || `${g.guaranteeNo ?? ''} ${g.tender?.ifbNumber ?? ''} ${g.beneficiary ?? ''} ${g.bankName}`.toLowerCase().includes(q)));
  });
  alertRows = computed(() => {
    const order = ['EXPIRED_OPEN', 'RELEASE_DUE', 'EXPIRING', 'SHORT_VALIDITY', 'NO_NUMBER'];
    return this.list()
      .flatMap((g) => (g.alerts ?? []).map((a: any) => ({ key: g.id + a.code, code: a.code, message: a.message, g })))
      .sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  });
  companyBanks = computed(() => this.banks().filter((b) => b.companyId === this.fc() && (b.isActive || b.id === this.f.bankId)));
  companyBids = computed(() => this.bids().filter((b) => b.companyId === this.fc()));
  projects = signal<any[]>([]);
  companyProjects = computed(() => this.projects().filter((x) => x.companyId === this.fc()));
  /** company chosen in the form, as a signal so the lists above update */
  fc = signal('');

  constructor() {
    this.load();
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: () => {} });
    this.loadBanks();
    this.data.getBids().subscribe({ next: (l) => this.bids.set(l), error: () => {} }); // empty if Bolpatra is off
    this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l), error: () => {} });
    this.data.getProjects().subscribe({ next: (l) => this.projects.set(l), error: () => {} }); // empty if Project Management is off
    const q = this.route.snapshot.queryParamMap;
    if (q.get('project')) this.newForProject(q.get('project')!);
    if (q.get('bank')) { this.fBank.set(q.get('bank')!); this.fStatus.set(''); }
    if (q.get('id')) this.openById(q.get('id')!);
  }

  // ---------- helpers ----------
  typeLabel(k: string) { return GUARANTEE_TYPE_LABEL[k] ?? k; }
  statusLabel(k: string) { return GUARANTEE_STATUS_LABEL[k] ?? k; }
  basisLabel(k: string) { return BASIS_LABEL[k] ?? k; }
  actionLabel(a: string) { return String(a).split(',').map((x) => ACTION_LABEL[x] ?? (x.startsWith('STATUS_') ? 'Status → ' + this.statusLabel(x.slice(7)) : x)).join(', '); }
  open(s: string) { return s === 'REQUESTED' || s === 'ACTIVE'; }
  num(v: any) { return v == null ? 0 : Number(v); }
  min100(v: number) { return Math.min(100, Math.max(0, v)); }
  bs(d: any) { return d ? adToBs(String(d).slice(0, 10)) : ''; }
  daysText(n: number | null) { return n == null ? '' : n < 0 ? `expired ${-n}d ago` : n === 0 ? 'today' : `${n}d left`; }
  alertTone(c: string) { return c === 'EXPIRED_OPEN' ? 'bad' : c === 'RELEASE_DUE' || c === 'EXPIRING' || c === 'SHORT_VALIDITY' ? 'warn' : 'info'; }
  alertIcon(c: string) { return c === 'EXPIRED_OPEN' ? '⛔' : c === 'RELEASE_DUE' ? '↩' : c === 'EXPIRING' ? '⏰' : c === 'SHORT_VALIDITY' ? '⚠' : 'ℹ'; }
  marginHint() { const a = Number(this.f.amount), p = this.f.marginPct; return a && p !== null && p !== '' && p !== undefined ? `≈ ${(Math.round(a * Number(p)) / 100).toLocaleString('en-IN')}` : ''; }
  commissionHint() {
    const v = estimate(Number(this.f.amount), this.f.commissionPct === '' || this.f.commissionPct == null ? null : Number(this.f.commissionPct), this.f.commissionBasis, this.f.issueDate, this.f.expiryDate);
    return v == null ? '' : `≈ ${v.toLocaleString('en-IN')}`;
  }

  load() {
    this.loading.set(true);
    this.data.getGuarantees({ days: String(this.days()) }).subscribe({
      next: (l) => { this.list.set(l); this.loading.set(false); },
      error: (e) => { this.error.set(errorText(e)); this.loading.set(false); },
    });
    this.data.getGuaranteeSummary(this.days()).subscribe({ next: (s) => this.sum.set(s), error: () => {} });
  }
  loadBanks() { this.data.getBanks().subscribe({ next: (l) => this.banks.set(l), error: () => {} }); }
  setDays(d: number) { this.days.set(Number(d)); this.load(); }

  // ---------- form ----------
  private blank() {
    const f: any = { type: 'PERFORMANCE', status: 'ACTIVE', companyId: this.fCompany() || (this.companies().length === 1 ? this.companies()[0].id : ''), bankId: '', bidId: '', tenderId: '', projectId: '' };
    for (const k of DATE_KEYS) f[k] = '';
    for (const k of NUM_KEYS) f[k] = null;
    for (const k of TEXT_KEYS) f[k] = '';
    return f;
  }
  openNew() {
    this.f = this.blank();
    this.fc.set(this.f.companyId);
    this.cur.set(null);
    this.formError.set('');
    this.okMsg.set('');
    this.confirmDel.set(false);
    this.showForm.set(true);
  }
  close() { this.showForm.set(false); this.cur.set(null); }

  async openById(id: string) {
    this.formError.set('');
    try {
      const g = await firstValueFrom(this.data.getGuarantee(id));
      const f: any = { type: g.type, status: g.status, companyId: g.companyId, bankId: g.bankId ?? '', bidId: g.bidId ?? '', tenderId: g.tenderId ?? '', projectId: g.projectId ?? '' };
      for (const k of DATE_KEYS) f[k] = g[k] ? String(g[k]).slice(0, 10) : '';
      for (const k of NUM_KEYS) f[k] = g[k] == null ? null : Number(g[k]);
      for (const k of TEXT_KEYS) f[k] = g[k] ?? '';
      this.f = f;
      this.fc.set(g.companyId);
      this.cur.set(g);
      this.confirmDel.set(false);
      this.showForm.set(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  onCompany() {
    this.fc.set(this.f.companyId);
    if (this.f.bankId && !this.companyBanks().some((b) => b.id === this.f.bankId)) this.f.bankId = '';
    if (this.f.bidId && !this.companyBids().some((b) => b.id === this.f.bidId)) this.f.bidId = '';
    if (this.f.projectId && !this.companyProjects().some((x) => x.id === this.f.projectId)) this.f.projectId = '';
  }
  onBank() {
    const b = this.banks().find((x) => x.id === this.f.bankId);
    if (!b) return;
    this.f.bankName = b.name;
    if (!this.f.branch) this.f.branch = b.branch ?? '';
    if (this.f.marginPct == null || this.f.marginPct === '') this.f.marginPct = b.defaultMarginPct != null ? Number(b.defaultMarginPct) : null;
    if (this.f.commissionPct == null || this.f.commissionPct === '') this.f.commissionPct = b.defaultCommissionPct != null ? Number(b.defaultCommissionPct) : null;
    if (!this.f.commissionBasis) this.f.commissionBasis = b.commissionBasis ?? '';
  }
  onBid() {
    const b = this.bids().find((x) => x.id === this.f.bidId);
    if (!b) return;
    this.f.tenderId = b.tenderId;
    if (!this.f.beneficiary) this.f.beneficiary = b.tender?.procuringEntity ?? '';
    if (!this.f.amount) {
      const v = this.f.type === 'BID_SECURITY' ? b.bidSecurityAmount : this.f.type === 'PERFORMANCE' ? b.performanceSecurityAmount : null;
      if (v != null) this.f.amount = Number(v);
    }
  }
  /** "+ Add guarantee" from a project page */
  async newForProject(projectId: string) {
    try {
      const p = await firstValueFrom(this.data.getProject(projectId));
      this.openNew();
      this.f.companyId = p.companyId;
      this.fc.set(p.companyId);
      this.f.projectId = p.id;
      this.f.tenderId = p.tenderId ?? '';
      this.f.beneficiary = p.client ?? '';
      this.f.type = 'ADVANCE_PAYMENT';
      this.okMsg.set(`New guarantee for project ${p.code} — ${p.name}.`);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
  onProject() {
    const x = this.projects().find((p) => p.id === this.f.projectId);
    if (!x) return;
    if (x.tenderId && !this.f.tenderId) this.f.tenderId = x.tenderId;
    if (!this.f.beneficiary) this.f.beneficiary = x.client ?? '';
  }
  onTender() {
    const t = this.tenders().find((x) => x.id === this.f.tenderId);
    if (t && !this.f.beneficiary) this.f.beneficiary = t.procuringEntity ?? '';
  }

  fromPdf(p: PdfApply) {
    const x = p.fields;
    if (x['bidSecurityAmount'] !== undefined) this.f.amount = x['bidSecurityAmount'];
    if (x['bidSecurityRef'] !== undefined) this.f.guaranteeNo = x['bidSecurityRef'];
    if (x['bidSecurityIssueDate'] !== undefined) this.f.issueDate = x['bidSecurityIssueDate'];
    if (x['bidSecurityExpiry'] !== undefined) this.f.expiryDate = x['bidSecurityExpiry'];
    if (x['guaranteeKind'] && PDF_KIND[x['guaranteeKind']]) this.f.type = PDF_KIND[x['guaranteeKind']];
    if (x['bidSecurityBank'] !== undefined) {
      const name = String(x['bidSecurityBank']).trim().toLowerCase();
      const match = this.companyBanks().find((b) => b.name.trim().toLowerCase() === name || name.startsWith(b.name.trim().toLowerCase().replace(/ limited$/, '')));
      if (match) { this.f.bankId = match.id; this.onBank(); } else { this.f.bankId = ''; this.f.bankName = x['bidSecurityBank']; }
    }
    if (this.f.guaranteeNo && this.f.status === 'REQUESTED') this.f.status = 'ACTIVE';
    this.okMsg.set(`📄 Filled from ${p.fileName} — check the values, then click Save guarantee.`);
  }

  private body(): any | null {
    const f = this.f;
    if (!f.companyId) { this.formError.set('Choose the company that applied for the guarantee.'); return null; }
    if (!f.bankId && !String(f.bankName ?? '').trim()) { this.formError.set('Choose a bank or type the bank name.'); return null; }
    const body: any = { type: f.type, status: f.status, companyId: f.companyId, bankId: f.bankId || null, bidId: f.bidId || null, tenderId: f.bidId ? null : f.tenderId || null, projectId: f.bidId ? null : f.projectId || null };
    for (const k of DATE_KEYS) body[k] = f[k] || null;
    for (const k of NUM_KEYS) {
      const v = f[k];
      if (v === null || v === '' || v === undefined) { body[k] = null; continue; }
      const n = Number(v);
      if (!isFinite(n) || n < 0 || (k.endsWith('Pct') && n > 100)) { this.formError.set('Please check the amounts and % values.'); return null; }
      body[k] = n;
    }
    if (!body.amount || body.amount < 1) { this.formError.set('Enter the guarantee amount.'); return null; }
    for (const k of TEXT_KEYS) body[k] = String(f[k] ?? '').trim() || null;
    if (body.bankId) delete body.bankName;
    if (!this.cur()) for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
    return body;
  }

  async save() {
    this.formError.set('');
    const body = this.body();
    if (!body) return;
    this.saving.set(true);
    try {
      const g = this.cur() ? await firstValueFrom(this.data.updateGuarantee(this.cur().id, body)) : await firstValueFrom(this.data.createGuarantee(body));
      this.okMsg.set(`✅ Guarantee saved (${this.statusLabel(g.status)}).${g.bidId ? ' The linked bid was updated too.' : ''}`);
      this.load();
      this.loadBanks();
      await this.openById(g.id);
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }

  async markReleased() {
    this.f.status = 'RELEASED';
    if (!this.f.releaseDate) this.f.releaseDate = new Date().toISOString().slice(0, 10);
    await this.save();
  }

  async remove() {
    this.confirmDel.set(false);
    try {
      await firstValueFrom(this.data.deleteGuarantee(this.cur().id));
      this.close();
      this.okMsg.set('🗑️ Guarantee deleted.');
      this.load();
    } catch (e) {
      this.formError.set(errorText(e));
    }
  }

  async syncBids() {
    this.syncing.set(true);
    this.okMsg.set('');
    try {
      const r = await firstValueFrom(this.data.syncGuaranteesFromBids());
      this.okMsg.set(`✅ Checked all bids: ${r.created} new, ${r.updated} updated, ${r.linked} linked to existing guarantees.`);
      this.load();
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.syncing.set(false);
  }

  // ---------- Excel ----------
  impRows = signal<SheetRow[]>([]);
  impError = signal('');
  impFile = signal('');
  importing = signal(false);
  async exportExcel() { (await loadSheets()).exportGuarantees(this.filtered()); }
  async template() { (await loadSheets()).guaranteesTemplate(); }
  async onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.okMsg.set('');
    this.impError.set('');
    this.impRows.set([]);
    this.impFile.set(file.name);
    try {
      const rows = await (await loadSheets()).readGuaranteesFile(file, this.companies(), this.banks(), this.tenders(), this.list());
      this.impRows.set(rows);
      if (!rows.length) this.impError.set('No guarantee rows found in the file.');
    } catch (err: any) {
      this.impError.set(err?.message || 'Could not read this file. Please use the Excel Template.');
    }
  }
  async runImport() {
    this.importing.set(true);
    let saved = 0;
    for (const row of this.impRows().filter((r) => r.status === 'ready')) {
      this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'saving' } : r)));
      try {
        await firstValueFrom(this.data.createGuarantee(row.body));
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'saved', message: '' } : r)));
        saved++;
      } catch (err) {
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'failed', message: errorText(err) } : r)));
      }
    }
    this.importing.set(false);
    this.okMsg.set(`✅ Import finished: ${saved} guarantee${saved === 1 ? '' : 's'} added.`);
    this.load();
  }
}
