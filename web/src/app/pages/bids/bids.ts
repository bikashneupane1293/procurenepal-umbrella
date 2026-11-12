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
import { showBoth, adToBs } from '../../core/nepali-date';
import { verdictText } from '../../shared/qual-result';
import type { SheetRow } from '../../core/sheets';
import { STATUS_LABEL } from '../../core/bid-labels';

const loadSheets = () => import('../../core/sheets');

const DECISION_LABEL: Record<string, string> = { UNDECIDED: 'Undecided', BID: 'Bid', NO_BID: 'No bid' };
const SEC_LABEL: Record<string, string> = { BANK_GUARANTEE: 'Bank guarantee', CASH_DEPOSIT: 'Cash deposit', INSURANCE_BOND: 'Insurance bond', DECLARATION: 'Bid-securing declaration' };
const DATE_KEYS = ['submittedAt', 'openingDate', 'bidSecurityIssueDate', 'bidSecurityExpiry', 'bidValidityExpiry', 'intentionDate', 'awardDate', 'contractSignDate', 'performanceSecurityExpiry'];
const NUM_KEYS = ['bidAmount', 'rank', 'bidSecurityAmount', 'contractAmount', 'performanceSecurityAmount'];
const TEXT_KEYS = ['decisionReason', 'bidSecurityType', 'bidSecurityBank', 'bidSecurityRef', 'notes'];

interface PartnerRow { companyId: string; share: number | null; }

@Component({
  selector: 'app-bids',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, DateField, ImportPanel, PdfFill],
  template: `
    <div class="bar">
      <div>
        <h1>Bid Information Management</h1>
        <p class="sub">Bid / no-bid decision, bid security, document checklist and post-bid status for every tender. The tender's status updates itself from its bids.</p>
      </div>
      <div class="tools">
        @if (bids().length) { <button class="btn light" (click)="exportExcel()">⬇ Export Excel</button> }
        <button class="btn light" (click)="template()">📄 Excel Template</button>
        <button class="btn light" (click)="fileInput.click()">⬆ Import Excel</button>
        <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
        @if (!showNew()) { <button class="btn gold" (click)="openNew()">+ New Bid</button> }
      </div>
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }
    @if (error()) { <div class="msg error">{{ error() }}</div> }

    @if (impRows().length || impError()) {
      <app-import-panel [rows]="impRows()" [headers]="['IFB No.', 'Company', 'Type', 'Status']" [fileName]="impFile()"
        [error]="impError()" [busy]="importing()" (run)="runImport()" (closed)="impRows.set([]); impError.set('')" />
    }

    <!-- New bid -->
    @if (showNew()) {
      <form class="panel" (ngSubmit)="create()">
        <h2>New Bid Record</h2>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }
        <div class="grid">
          <div><label>Tender <span class="req">*</span></label>
            <select name="nt" [(ngModel)]="nf.tenderId">
              <option value="">— Select tender —</option>
              @for (t of tenders(); track t.id) { <option [value]="t.id">{{ t.ifbNumber }} — {{ t.projectTitle }}</option> }
            </select>
            @if (!tenders().length) { <div class="help"><a class="link" routerLink="/tenders">Add a tender first →</a></div> }</div>
          <div><label>Bidding company (lead for a JV) <span class="req">*</span></label>
            <select name="nc" [(ngModel)]="nf.companyId">
              <option value="">— Select company —</option>
              @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select></div>
          <div><label>Bidder type</label>
            <select name="ntype" [(ngModel)]="nf.bidderType">
              <option value="SINGLE">Single bidder</option><option value="JV">Joint Venture</option>
            </select></div>
          <div><label>Decision</label>
            <select name="nd" [(ngModel)]="nf.decision">
              <option value="UNDECIDED">Undecided</option><option value="BID">Bid</option><option value="NO_BID">No bid</option>
            </select></div>
        </div>
        @if (nf.bidderType === 'JV') {
          <h3>JV partners (shares total 100%)</h3>
          <div class="table-wrap"><table class="acts">
            <thead><tr><th>Company</th><th class="num">Share %</th><th></th></tr></thead>
            <tbody>
              @for (p of nfPartners; track $index; let i = $index) {
                <tr>
                  <td><select [name]="'np' + i" [(ngModel)]="p.companyId">
                    <option value="">— Select —</option>
                    @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
                  </select></td>
                  <td><input type="number" min="1" max="99" [name]="'ns' + i" [(ngModel)]="p.share" class="right" /></td>
                  <td>@if (nfPartners.length > 2) { <button type="button" class="btn danger" (click)="nfPartners.splice(i, 1)">🗑️</button> }</td>
                </tr>
              }
            </tbody>
          </table></div>
          @if (nfPartners.length < 3) { <button type="button" class="btn light" (click)="nfPartners.push({ companyId: '', share: null })">+ Add partner</button> }
          <div class="help">The bidding company above must be one of the partners and is the lead. Tip: check the JV first on the tender's "Check qualification" page.</div>
        }
        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Create bid record' }}</button>
          <button class="btn light" type="button" (click)="showNew.set(false)">Cancel</button>
        </div>
      </form>
    }

    <!-- Edit bid -->
    @if (sel(); as b) {
      <form class="panel edit" (ngSubmit)="save()">
        <div class="bar tight">
          <h2>{{ b.tender?.ifbNumber }} — {{ b.company?.name }} @if (b.bidderType === 'JV') { <span class="tag gold">JV</span> }</h2>
          <button type="button" class="btn light small" (click)="sel.set(null)">Close</button>
        </div>
        <p class="help">{{ b.tender?.projectTitle }} · Deadline {{ both(b.tender?.deadlineDate) }}
          · <a class="link" [routerLink]="['/tenders', b.tenderId]">Tender workspace →</a></p>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }

        @if (b.qualification; as q) {
          <div class="qual" [class]="'qual ' + tone(q.result)">Saved qualification: <strong>{{ verdict(q.result) }}</strong> — {{ q.explanation }}</div>
        } @else {
          <div class="qual none">No saved qualification check for this company yet. <a class="link" [routerLink]="['/tenders', b.tenderId]">Check qualification →</a></div>
        }

        <h3>1. Decision</h3>
        <div class="grid">
          <div><label>Bid / no-bid decision</label>
            <select name="decision" [(ngModel)]="f.decision">
              <option value="UNDECIDED">Undecided</option><option value="BID">Bid</option><option value="NO_BID">No bid</option>
            </select></div>
          <div class="wide"><label>Reason</label>
            <input name="decisionReason" [(ngModel)]="f.decisionReason" placeholder="e.g. Qualified alone; margin acceptable / Turnover short, no JV partner" /></div>
        </div>
        @if (b.bidderType === 'JV') {
          <div class="partners">JV: @for (p of b.jvPartners; track p.companyId) { <span class="tag">{{ p.name }} {{ p.share }}%{{ p.isLead ? ' (lead)' : '' }}</span> }</div>
        }

        <h3>2. Status and submission</h3>
        <div class="grid">
          <div><label>Status</label>
            <select name="status" [(ngModel)]="f.status">@for (s of statuses; track s) { <option [value]="s">{{ label(s) }}</option> }</select>
            <div class="help">The tender's status follows automatically (submitted / won / lost).</div></div>
          <div><label>Bid amount (NPR)</label>
            <input type="number" min="0" name="bidAmount" [(ngModel)]="f.bidAmount" placeholder="Your quoted price" />
            <div class="help tax">Enter taxable amount only (excluding VAT). Kept private to your workspace.</div></div>
          <app-date-field label="Submitted on" [(value)]="f.submittedAt" />
          <app-date-field label="Bid opening date" [(value)]="f.openingDate" />
          <div><label>Rank after opening</label>
            <input type="number" min="1" name="rank" [(ngModel)]="f.rank" placeholder="e.g. 1" /></div>
        </div>

        <h3>3. Bid security</h3>
        <app-pdf-fill kind="guarantee" (filled)="fromPdf($event, 'bid')" />
        <div class="grid">
          <div><label>Amount (NPR)</label>
            <input type="number" min="0" name="bsa" [(ngModel)]="f.bidSecurityAmount" />
            @if (b.tender?.bidSecurityAmount) { <div class="help">Required by the tender: Rs {{ num(b.tender.bidSecurityAmount) | number: '1.0-0' }}</div> }
            @if (securityShort()) { <div class="help err">Lower than the tender's required amount.</div> }</div>
          <div><label>Type</label>
            <select name="bst" [(ngModel)]="f.bidSecurityType">
              <option value="">— Select —</option>
              @for (k of secTypes; track k) { <option [value]="k">{{ secLabel(k) }}</option> }
            </select></div>
          <div><label>Issuing bank</label><input name="bsb" [(ngModel)]="f.bidSecurityBank" placeholder="e.g. Nabil Bank Ltd." /></div>
          <div><label>Guarantee No.</label><input name="bsr" [(ngModel)]="f.bidSecurityRef" /></div>
          <app-date-field label="Issue date" [(value)]="f.bidSecurityIssueDate" />
          <app-date-field label="Valid until (expiry)" [(value)]="f.bidSecurityExpiry" />
          <app-date-field label="Bid validity expiry" [(value)]="f.bidValidityExpiry" />
        </div>
        @if (b.guarantees?.length) {
          <div class="bglink">🏦 In Bank Guarantee Management:
            @for (g of b.guarantees; track g.id) {
              <a class="tag" routerLink="/bank-guarantees" [queryParams]="{ id: g.id }">{{ g.type === 'BID_SECURITY' ? 'Bid security' : g.type === 'PERFORMANCE' ? 'Performance' : g.type }} · {{ g.guaranteeNo || 'no number' }} · {{ g.status.toLowerCase() }}</a>
            }
          </div>
        } @else if (f.bidSecurityType === 'BANK_GUARANTEE') {
          <div class="help">When you save, a bank-guarantee bid security (with bank or number) is also recorded in Bank Guarantee Management.</div>
        }
        @if (validityGap() !== null && validityGap()! < 30) {
          <div class="msg info">Check the bid document: the bid security is usually required to stay valid about 30 days beyond the bid validity (now {{ validityGap() }} days).</div>
        }

        <h3>4. Document checklist ({{ doneCount() }} / {{ f.checklist.length }})</h3>
        <div class="checklist">
          @for (c of f.checklist; track c.key) {
            <label class="ck" [class.done]="c.done"><input type="checkbox" [checked]="c.done" (change)="c.done = !c.done" /> {{ c.label }}</label>
          }
        </div>

        <h3>5. After opening — award and contract</h3>
        <div class="grid">
          <app-date-field label="Letter of intention to award" [(value)]="f.intentionDate" />
          <app-date-field label="Award (acceptance) date" [(value)]="f.awardDate" />
          <app-date-field label="Contract signing date" [(value)]="f.contractSignDate" />
          <div><label>Contract amount (NPR)</label>
            <input type="number" min="0" name="ca" [(ngModel)]="f.contractAmount" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div></div>
        </div>
        <h4>Performance security</h4>
        <app-pdf-fill kind="guarantee" (filled)="fromPdf($event, 'performance')" />
        <div class="grid">
          <div><label>Amount (NPR)</label><input type="number" min="0" name="psa" [(ngModel)]="f.performanceSecurityAmount" /></div>
          <app-date-field label="Valid until (expiry)" [(value)]="f.performanceSecurityExpiry" />
        </div>

        <h3>6. Notes</h3>
        <textarea name="notes" [(ngModel)]="f.notes" rows="2"></textarea>

        @if (b.statusHistory?.length) {
          <div class="history">Status history:
            @for (h of b.statusHistory; track $index) { <span class="tag">{{ label(h.status) }} · {{ bs(h.at) }}</span> }
          </div>
        }

        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save bid' }}</button>
          @if (canDelete) { <button class="btn danger" type="button" (click)="confirmDel.set(true)">Delete bid record</button> }
        </div>
        @if (confirmDel()) {
          <div class="msg error">Delete the bid record for {{ b.tender?.ifbNumber }} — {{ b.company?.name }}? This cannot be undone.
            <button type="button" class="btn danger small" (click)="remove(b)">Delete permanently</button>
            <button type="button" class="btn light small" (click)="confirmDel.set(false)">Cancel</button>
          </div>
        }
      </form>
    }

    <!-- List -->
    <div class="panel">
      <div class="filters">
        <select name="fs" [ngModel]="fStatus()" (ngModelChange)="fStatus.set($event)">
          <option value="">All statuses</option>
          @for (s of statuses; track s) { <option [value]="s">{{ label(s) }}</option> }
        </select>
        <select name="fc" [ngModel]="fCompany()" (ngModelChange)="fCompany.set($event)">
          <option value="">All companies</option>
          @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
        <input name="fq" placeholder="Search IFB / project" [ngModel]="fText()" (ngModelChange)="fText.set($event)" />
      </div>
      @if (loading()) { <div class="msg info">Loading bids…</div> }
      @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tender</th><th>Bidder</th><th>Decision</th><th>Status</th><th class="num">Bid (NPR)</th><th>Security expiry</th><th>Checklist</th><th></th></tr></thead>
            <tbody>
              @for (b of filtered(); track b.id) {
                <tr [class.sel]="sel()?.id === b.id">
                  <td><strong>{{ b.tender?.ifbNumber }}</strong><div class="help">{{ b.tender?.projectTitle }}</div></td>
                  <td>{{ b.company?.name }} @if (b.bidderType === 'JV') { <span class="tag gold">JV</span> }</td>
                  <td>{{ dlabel(b.decision) }}</td>
                  <td><span class="st" [class]="'st ' + b.status">{{ label(b.status) }}</span></td>
                  <td class="num">{{ b.bidAmount != null ? (num(b.bidAmount) | number: '1.0-0') : '—' }}</td>
                  <td>@if (b.bidSecurityExpiry) { {{ bs(b.bidSecurityExpiry) }} <span class="days" [class.warn]="daysLeft(b.bidSecurityExpiry) <= 15">{{ daysText(b.bidSecurityExpiry) }}</span> } @else { — }</td>
                  <td>{{ checks(b) }}</td>
                  <td><button class="btn light small" (click)="open(b)">Open</button></td>
                </tr>
              } @empty { <tr><td colspan="8" class="empty">No bid records yet. Click <strong>+ New Bid</strong> or open a tender and click "Create bid record".</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [UI_STYLES, `
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 22px 0 10px; padding-top: 14px; border-top: 1px solid #eef0f2; }
    h4 { font-size: 13px; color: #1e3a5f; margin: 16px 0 8px; }
    .wide { grid-column: span 2; }
    .help.tax { color: #b8860b; }
    .help.err { color: #b91c1c; }
    .bar.tight { margin-bottom: 4px; align-items: center; }
    .bar.tight h2 { margin: 0; }
    .btn.small { padding: 6px 12px; }
    table.acts td { padding: 6px; border-bottom: 0; }
    input.right { text-align: right; }
    textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; }
    .qual { padding: 10px 12px; border-radius: 8px; font-size: 13px; margin: 8px 0; border: 1px solid; }
    .qual.good { background: #f0fdf4; border-color: #bbf7d0; color: #14532d; }
    .qual.mid { background: #fef5e0; border-color: #f5d98a; color: #6b4e06; }
    .qual.bad { background: #fef2f2; border-color: #fecaca; color: #7f1d1d; }
    .qual.none { background: #f9fafb; border-color: #e5e7eb; color: #4b5563; }
    .bglink { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; margin-top: 10px; }
    .bglink a.tag { text-decoration: none; }
    .partners, .history { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; margin-top: 8px; }
    .checklist { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 6px; }
    .ck { display: flex; gap: 8px; align-items: flex-start; font-weight: 500; font-size: 13px; border: 1px solid #e1e3e6; border-radius: 8px; padding: 8px 10px; margin: 0; cursor: pointer; }
    .ck input { width: auto; margin-top: 2px; }
    .ck.done { background: #f0fdf4; border-color: #bbf7d0; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .filters select, .filters input { width: auto; min-width: 180px; }
    .st { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 10px; background: #e8eef6; color: #1e3a5f; white-space: nowrap; }
    .st.AWARDED, .st.CONTRACT_SIGNED { background: #dcfce7; color: #15803d; }
    .st.LOST, .st.CANCELLED, .st.WITHDRAWN { background: #fee2e2; color: #b91c1c; }
    .st.SUBMITTED, .st.OPENED, .st.EVALUATED, .st.INTENTION_TO_AWARD { background: #fef5e0; color: #8a6508; }
    .days { font-size: 11px; color: #6b7280; }
    .days.warn { color: #b91c1c; font-weight: 700; }
    tr.sel td { background: #fffbeb; }
    @media (max-width: 700px) { .wide { grid-column: auto; } }
  `],
})
export class BidsPage {
  private data = inject(DataService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  canDelete = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'].includes(this.auth.getUser()?.role);
  statuses = Object.keys(STATUS_LABEL);
  secTypes = Object.keys(SEC_LABEL);

  bids = signal<any[]>([]);
  tenders = signal<any[]>([]);
  companies = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  okMsg = signal('');
  formError = signal('');
  saving = signal(false);
  showNew = signal(false);
  sel = signal<any | null>(null);
  fStatus = signal('');
  fCompany = signal('');
  fText = signal('');

  nf = { tenderId: '', companyId: '', bidderType: 'SINGLE', decision: 'UNDECIDED' };
  nfPartners: PartnerRow[] = [{ companyId: '', share: 60 }, { companyId: '', share: 40 }];
  f: any = { checklist: [] };

  filtered = computed(() => {
    const q = this.fText().trim().toLowerCase();
    return this.bids().filter((b) =>
      (!this.fStatus() || b.status === this.fStatus()) &&
      (!this.fCompany() || b.companyId === this.fCompany() || (b.jvPartners ?? []).some((p: any) => p.companyId === this.fCompany())) &&
      (!q || `${b.tender?.ifbNumber} ${b.tender?.projectTitle}`.toLowerCase().includes(q)));
  });

  constructor() {
    this.load();
    this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l), error: () => {} });
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: () => {} });
    const t = this.route.snapshot.queryParamMap.get('tender');
    if (t) { this.openNew(); this.nf.tenderId = t; }
    const b = this.route.snapshot.queryParamMap.get('bid');
    if (b) this.openById(b);
  }

  // ---------- helpers ----------
  label(s: string) { return STATUS_LABEL[s] ?? s; }
  dlabel(s: string) { return DECISION_LABEL[s] ?? s; }
  secLabel(s: string) { return SEC_LABEL[s] ?? s; }
  verdict(v: string) { return verdictText(v); }
  tone(v: string) { return v === 'INDIVIDUAL_ELIGIBLE' ? 'good' : v === 'JV_REQUIRED' ? 'mid' : 'bad'; }
  num(v: any) { return v == null ? 0 : Number(v); }
  both(d: any) { return showBoth(d); }
  bs(d: any) { return d ? adToBs(String(d).slice(0, 10)) : ''; }
  daysLeft(d: any) { return Math.ceil((new Date(String(d).slice(0, 10) + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 86400000); }
  daysText(d: any) { const n = this.daysLeft(d); return n < 0 ? `expired ${-n}d ago` : n === 0 ? 'today' : `${n}d left`; }
  checks(b: any) { const l = b.checklist ?? []; return l.length ? `${l.filter((c: any) => c.done).length}/${l.length}` : '—'; }
  doneCount() { return (this.f.checklist ?? []).filter((c: any) => c.done).length; }
  securityShort() {
    const req = Number(this.sel()?.tender?.bidSecurityAmount);
    return req > 0 && this.f.bidSecurityAmount !== null && this.f.bidSecurityAmount !== '' && Number(this.f.bidSecurityAmount) < req;
  }
  validityGap(): number | null {
    if (!this.f.bidSecurityExpiry || !this.f.bidValidityExpiry) return null;
    return Math.round((new Date(this.f.bidSecurityExpiry).getTime() - new Date(this.f.bidValidityExpiry).getTime()) / 86400000);
  }

  load() {
    this.loading.set(true);
    this.data.getBids().subscribe({
      next: (l) => { this.bids.set(l); this.loading.set(false); },
      error: (e) => { this.error.set(errorText(e)); this.loading.set(false); },
    });
  }

  // ---------- new ----------
  openNew() {
    this.showNew.set(true);
    this.sel.set(null);
    this.formError.set('');
    this.okMsg.set('');
    this.nf = { tenderId: '', companyId: '', bidderType: 'SINGLE', decision: 'UNDECIDED' };
    this.nfPartners = [{ companyId: '', share: 60 }, { companyId: '', share: 40 }];
  }

  async create() {
    this.formError.set('');
    if (!this.nf.tenderId || !this.nf.companyId) { this.formError.set('Choose the tender and the bidding company.'); return; }
    const body: any = { ...this.nf };
    if (this.nf.bidderType === 'JV') {
      const rows = this.nfPartners.filter((p) => p.companyId);
      if (rows.length < 2) { this.formError.set('A JV needs at least two partners.'); return; }
      if (!rows.some((p) => p.companyId === this.nf.companyId)) { this.formError.set('The bidding company must be one of the JV partners.'); return; }
      const total = rows.reduce((s, p) => s + (Number(p.share) || 0), 0);
      if (Math.abs(total - 100) > 0.01) { this.formError.set(`JV shares add up to ${total}% — they must total 100%.`); return; }
      body.jvPartners = rows.map((p) => ({ companyId: p.companyId, share: Number(p.share), isLead: p.companyId === this.nf.companyId }));
    }
    this.saving.set(true);
    try {
      const b = await firstValueFrom(this.data.createBid(body));
      this.showNew.set(false);
      this.okMsg.set(`✅ Bid record created for ${b.tender?.ifbNumber} — ${b.company?.name}. Fill the details below.`);
      this.load();
      await this.openById(b.id);
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }

  // ---------- edit ----------
  async open(b: any) { await this.openById(b.id); }
  async openById(id: string) {
    this.formError.set('');
    try {
      const b = await firstValueFrom(this.data.getBid(id));
      const d = (v: any) => (v ? String(v).slice(0, 10) : '');
      const n = (v: any) => (v == null ? null : Number(v));
      this.f = {
        decision: b.decision, status: b.status,
        checklist: (b.checklist ?? []).map((c: any) => ({ ...c })),
        ...Object.fromEntries(DATE_KEYS.map((k) => [k, d(b[k])])),
        ...Object.fromEntries(NUM_KEYS.map((k) => [k, n(b[k])])),
        ...Object.fromEntries(TEXT_KEYS.map((k) => [k, b[k] ?? ''])),
      };
      this.showNew.set(false);
      this.confirmDel.set(false);
      this.sel.set(b);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  fromPdf(p: PdfApply, which: 'bid' | 'performance') {
    const x = p.fields;
    if (which === 'bid') {
      for (const k of ['bidSecurityAmount', 'bidSecurityBank', 'bidSecurityRef', 'bidSecurityIssueDate', 'bidSecurityExpiry']) if (x[k] !== undefined) this.f[k] = x[k];
      if (!this.f.bidSecurityType) this.f.bidSecurityType = 'BANK_GUARANTEE';
    } else {
      if (x['bidSecurityAmount'] !== undefined) this.f.performanceSecurityAmount = x['bidSecurityAmount'];
      if (x['bidSecurityExpiry'] !== undefined) this.f.performanceSecurityExpiry = x['bidSecurityExpiry'];
    }
    this.okMsg.set(`📄 Filled from ${p.fileName} — check the values, then click Save bid.`);
  }

  async save() {
    const b = this.sel();
    if (!b) return;
    this.formError.set('');
    const body: any = { decision: this.f.decision, status: this.f.status, checklist: this.f.checklist };
    for (const k of DATE_KEYS) body[k] = this.f[k] || null;
    for (const k of NUM_KEYS) {
      const v = this.f[k];
      if (v === null || v === '' || v === undefined) { body[k] = null; continue; }
      const nv = Number(v);
      if (!isFinite(nv) || nv < 0) { this.formError.set(`Please check the number in "${k}".`); return; }
      body[k] = k === 'rank' ? Math.max(1, Math.round(nv)) : nv;
    }
    for (const k of TEXT_KEYS) body[k] = String(this.f[k] ?? '').trim() || null;
    this.saving.set(true);
    try {
      await firstValueFrom(this.data.updateBid(b.id, body));
      this.okMsg.set(`✅ Bid saved (${this.label(body.status)}). The tender's status was updated automatically.`);
      this.load();
      await this.openById(b.id);
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }

  confirmDel = signal(false);
  async remove(b: any) {
    this.confirmDel.set(false);
    try {
      await firstValueFrom(this.data.deleteBid(b.id));
      this.sel.set(null);
      this.okMsg.set('🗑️ Bid record deleted.');
      this.load();
    } catch (e) {
      this.formError.set(errorText(e));
    }
  }

  // ---------- Excel ----------
  impRows = signal<SheetRow[]>([]);
  impError = signal('');
  impFile = signal('');
  importing = signal(false);
  async exportExcel() { (await loadSheets()).exportBids(this.filtered()); }
  async template() { (await loadSheets()).bidsTemplate(); }
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
      const rows = await (await loadSheets()).readBidsFile(file, this.tenders(), this.companies(), this.bids());
      this.impRows.set(rows);
      if (!rows.length) this.impError.set('No bid rows found in the file.');
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
        await firstValueFrom(this.data.createBid(row.body));
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'saved', message: '' } : r)));
        saved++;
      } catch (err) {
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'failed', message: errorText(err) } : r)));
      }
    }
    this.importing.set(false);
    this.okMsg.set(`✅ Import finished: ${saved} bid record${saved === 1 ? '' : 's'} added.`);
    this.load();
  }
}
