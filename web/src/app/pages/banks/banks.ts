import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { AuthService } from '../../core/auth.service';
import { UI_STYLES } from '../../core/ui-styles';
import { ImportPanel } from '../../shared/import-panel';
import type { SheetRow } from '../../core/sheets';

const loadSheets = () => import('../../core/bank-sheets');
const ACCOUNT_LABEL: Record<string, string> = { CURRENT: 'Current', SAVINGS: 'Savings', OVERDRAFT: 'Overdraft', FIXED: 'Fixed deposit', OTHER: 'Other' };
const BASIS_LABEL: Record<string, string> = { QUARTER: 'per quarter', YEAR: 'per year', FLAT: 'once (flat)' };
const NUM_KEYS = ['bgLimit', 'defaultMarginPct', 'defaultCommissionPct'];
const TEXT_KEYS = ['name', 'branch', 'accountNumber', 'accountType', 'commissionBasis', 'contactPerson', 'phone', 'email', 'notes'];

@Component({
  selector: 'app-banks',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, ImportPanel],
  template: `
    <div class="bar">
      <div>
        <h1>Bank Management</h1>
        <p class="sub">Each company's banks, accounts and guarantee (non-fund) limits. Open bank guarantees are added up against each limit automatically.</p>
      </div>
      <div class="tools">
        @if (banks().length) { <button class="btn light" (click)="exportExcel()">⬇ Export Excel</button> }
        <button class="btn light" (click)="template()">📄 Excel Template</button>
        <button class="btn light" (click)="fileInput.click()">⬆ Import Excel</button>
        <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
        @if (!showForm()) { <button class="btn gold" (click)="openNew()">+ Add Bank</button> }
      </div>
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }
    @if (error()) { <div class="msg error">{{ error() }}</div> }

    @if (impRows().length || impError()) {
      <app-import-panel [rows]="impRows()" [headers]="['Company', 'Bank', 'Branch', 'Limit (NPR)']" [fileName]="impFile()"
        [error]="impError()" [busy]="importing()" (run)="runImport()" (closed)="impRows.set([]); impError.set('')" />
    }

    @if (showForm()) {
      <form class="panel" (ngSubmit)="save()">
        <div class="bar tight">
          <h2>{{ editId() ? 'Edit bank' : 'Add bank' }}</h2>
          <button type="button" class="btn light small" (click)="showForm.set(false)">Close</button>
        </div>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }
        <div class="grid">
          <div><label>Company <span class="req">*</span></label>
            <select name="companyId" [(ngModel)]="f.companyId">
              <option value="">— Select company —</option>
              @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select></div>
          <div><label>Bank name <span class="req">*</span></label>
            <input name="name" [(ngModel)]="f.name" list="bank-names" placeholder="e.g. Nabil Bank Limited" />
            <datalist id="bank-names">@for (b of knownBanks; track b) { <option [value]="b"></option> }</datalist></div>
          <div><label>Branch</label><input name="branch" [(ngModel)]="f.branch" placeholder="e.g. Kamaladi" /></div>
          <div><label>Account number</label><input name="accountNumber" [(ngModel)]="f.accountNumber" /></div>
          <div><label>Account type</label>
            <select name="accountType" [(ngModel)]="f.accountType">
              <option value="">—</option>
              @for (k of accountTypes; track k) { <option [value]="k">{{ accountLabel(k) }}</option> }
            </select></div>
          <div><label>Guarantee (non-fund) limit (NPR)</label>
            <input type="number" min="0" name="bgLimit" [(ngModel)]="f.bgLimit" placeholder="Sanctioned BG limit" /></div>
          <div><label>Usual margin %</label>
            <input type="number" min="0" max="100" step="0.01" name="defaultMarginPct" [(ngModel)]="f.defaultMarginPct" placeholder="e.g. 10" />
            <div class="help">Cash margin the bank holds per guarantee</div></div>
          <div><label>Usual commission %</label>
            <input type="number" min="0" max="100" step="0.001" name="defaultCommissionPct" [(ngModel)]="f.defaultCommissionPct" placeholder="e.g. 0.5" /></div>
          <div><label>Commission charged</label>
            <select name="commissionBasis" [(ngModel)]="f.commissionBasis">
              <option value="">—</option>
              @for (k of bases; track k) { <option [value]="k">{{ basisLabel(k) }}</option> }
            </select></div>
          <div><label>Contact person</label><input name="contactPerson" [(ngModel)]="f.contactPerson" /></div>
          <div><label>Phone</label><input name="phone" [(ngModel)]="f.phone" /></div>
          <div><label>Email</label><input name="email" type="email" [(ngModel)]="f.email" /></div>
        </div>
        <label class="inline"><input type="checkbox" name="isActive" [(ngModel)]="f.isActive" /> Active</label>
        <label>Notes</label>
        <textarea name="notes" [(ngModel)]="f.notes" rows="2" placeholder="e.g. Limit renewed 2083/04, valid one year"></textarea>
        <p class="help">Margin and commission rates differ between banks — they are copied into new guarantees as a starting point and can be changed on each guarantee.</p>
        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save bank' }}</button>
          @if (editId() && canDelete) { <button class="btn danger" type="button" (click)="confirmDel.set(true)">Delete bank</button> }
        </div>
        @if (confirmDel()) {
          <div class="msg error">Delete {{ f.name }}? Closed guarantees keep the bank's name. A bank with open guarantees cannot be deleted.
            <button type="button" class="btn danger small" (click)="remove()">Delete permanently</button>
            <button type="button" class="btn light small" (click)="confirmDel.set(false)">Cancel</button>
          </div>
        }
      </form>
    }

    <div class="panel">
      <div class="filters">
        <select name="fc" [ngModel]="fCompany()" (ngModelChange)="fCompany.set($event)">
          <option value="">All companies</option>
          @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
        <a class="link" routerLink="/bank-guarantees">Bank Guarantee Management →</a>
      </div>
      @if (loading()) { <div class="msg info">Loading banks…</div> }
      @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Bank / branch</th><th>Company</th><th>Account</th><th class="num">BG limit (NPR)</th><th class="num">Used</th><th class="num">Available</th><th>Use</th><th class="num">Open BGs</th><th></th></tr></thead>
            <tbody>
              @for (b of filtered(); track b.id) {
                <tr [class.off]="!b.isActive">
                  <td><strong>{{ b.name }}</strong>@if (b.branch) { <div class="help">{{ b.branch }}</div> }</td>
                  <td>{{ b.company?.name }}</td>
                  <td>{{ b.accountNumber || '—' }}@if (b.accountType) { <div class="help">{{ accountLabel(b.accountType) }}</div> }</td>
                  <td class="num">{{ b.bgLimit != null ? (num(b.bgLimit) | number: '1.0-0') : '—' }}</td>
                  <td class="num">{{ b.used | number: '1.0-0' }}</td>
                  <td class="num" [class.bad]="b.available != null && b.available < 0">{{ b.available != null ? (b.available | number: '1.0-0') : '—' }}</td>
                  <td class="use">@if (b.usedPct != null) {
                    <div class="meter"><span [style.width.%]="min100(b.usedPct)" [class.hi]="b.usedPct >= 80" [class.over]="b.usedPct > 100"></span></div>
                    <div class="help">{{ b.usedPct }}%</div> } @else { <span class="help">no limit set</span> }</td>
                  <td class="num"><a class="link" routerLink="/bank-guarantees" [queryParams]="{ bank: b.id }">{{ b.openGuarantees }}</a></td>
                  <td><button class="btn light small" (click)="edit(b)">Edit</button></td>
                </tr>
              } @empty { <tr><td colspan="9" class="empty">No banks yet. Click <strong>+ Add Bank</strong> or import the Excel template.</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [UI_STYLES, `
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .bar.tight { margin-bottom: 4px; align-items: center; }
    .bar.tight h2 { margin: 0; }
    .btn.small { padding: 6px 12px; }
    textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; }
    label.inline { display: inline-flex; gap: 8px; align-items: center; margin: 12px 0 4px; }
    label.inline input { width: auto; }
    .filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
    .filters select { width: auto; min-width: 200px; }
    .meter { width: 110px; height: 8px; background: #eef0f2; border-radius: 4px; overflow: hidden; }
    .meter span { display: block; height: 100%; background: #1e3a5f; }
    .meter span.hi { background: #d4a017; }
    .meter span.over { background: #b91c1c; }
    td.bad { color: #b91c1c; font-weight: 700; }
    tr.off td { color: #9ca3af; }
  `],
})
export class BanksPage {
  private data = inject(DataService);
  private auth = inject(AuthService);

  canDelete = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'].includes(this.auth.getUser()?.role);
  accountTypes = Object.keys(ACCOUNT_LABEL);
  bases = Object.keys(BASIS_LABEL);
  /** suggestions only — any bank name can be typed */
  knownBanks = [
    'Nabil Bank Limited', 'Nepal Investment Mega Bank Limited', 'Global IME Bank Limited', 'NIC Asia Bank Limited', 'Himalayan Bank Limited',
    'Everest Bank Limited', 'Standard Chartered Bank Nepal Limited', 'Nepal SBI Bank Limited', 'Kumari Bank Limited', 'Laxmi Sunrise Bank Limited',
    'Prabhu Bank Limited', 'Siddhartha Bank Limited', 'Sanima Bank Limited', 'Machhapuchchhre Bank Limited', 'Citizens Bank International Limited',
    'Prime Commercial Bank Limited', 'NMB Bank Limited', 'Nepal Bank Limited', 'Rastriya Banijya Bank Limited', 'Agricultural Development Bank Limited',
  ];

  banks = signal<any[]>([]);
  companies = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  okMsg = signal('');
  formError = signal('');
  saving = signal(false);
  showForm = signal(false);
  editId = signal<string | null>(null);
  confirmDel = signal(false);
  fCompany = signal('');
  f: any = {};

  filtered = computed(() => this.banks().filter((b) => !this.fCompany() || b.companyId === this.fCompany()));

  constructor() {
    this.load();
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: () => {} });
  }

  accountLabel(k: string) { return ACCOUNT_LABEL[k] ?? k; }
  basisLabel(k: string) { return BASIS_LABEL[k] ?? k; }
  num(v: any) { return v == null ? 0 : Number(v); }
  min100(v: number) { return Math.min(100, Math.max(0, v)); }

  load() {
    this.loading.set(true);
    this.data.getBanks().subscribe({
      next: (l) => { this.banks.set(l); this.loading.set(false); },
      error: (e) => { this.error.set(errorText(e)); this.loading.set(false); },
    });
  }

  openNew() {
    this.f = { companyId: this.fCompany() || (this.companies().length === 1 ? this.companies()[0].id : ''), isActive: true };
    for (const k of [...NUM_KEYS]) this.f[k] = null;
    for (const k of TEXT_KEYS) this.f[k] = '';
    this.editId.set(null);
    this.formError.set('');
    this.okMsg.set('');
    this.confirmDel.set(false);
    this.showForm.set(true);
  }

  edit(b: any) {
    this.f = { companyId: b.companyId, isActive: b.isActive };
    for (const k of NUM_KEYS) this.f[k] = b[k] == null ? null : Number(b[k]);
    for (const k of TEXT_KEYS) this.f[k] = b[k] ?? '';
    this.editId.set(b.id);
    this.formError.set('');
    this.confirmDel.set(false);
    this.showForm.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async save() {
    this.formError.set('');
    if (!this.f.companyId || !String(this.f.name ?? '').trim()) { this.formError.set('Choose the company and type the bank name.'); return; }
    const body: any = { companyId: this.f.companyId, isActive: !!this.f.isActive };
    for (const k of NUM_KEYS) {
      const v = this.f[k];
      if (v === null || v === '' || v === undefined) { body[k] = null; continue; }
      const n = Number(v);
      if (!isFinite(n) || n < 0 || (k !== 'bgLimit' && n > 100)) { this.formError.set('Please check the limit and the % values.'); return; }
      body[k] = n;
    }
    for (const k of TEXT_KEYS) {
      const v = String(this.f[k] ?? '').trim();
      if (v) body[k] = v;
      else if (this.editId() && k !== 'name') body[k] = null;
    }
    this.saving.set(true);
    try {
      if (this.editId()) await firstValueFrom(this.data.updateBank(this.editId()!, body));
      else await firstValueFrom(this.data.createBank(body));
      this.okMsg.set(`✅ ${body.name} saved.${this.editId() ? '' : ' Guarantees already typed with this bank name were attached to it.'}`);
      this.showForm.set(false);
      this.load();
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }

  async remove() {
    this.confirmDel.set(false);
    try {
      await firstValueFrom(this.data.deleteBank(this.editId()!));
      this.showForm.set(false);
      this.okMsg.set('🗑️ Bank deleted.');
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
  async exportExcel() { (await loadSheets()).exportBanks(this.filtered()); }
  async template() { (await loadSheets()).banksTemplate(); }
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
      const rows = await (await loadSheets()).readBanksFile(file, this.companies(), this.banks());
      this.impRows.set(rows);
      if (!rows.length) this.impError.set('No bank rows found in the file.');
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
        await firstValueFrom(this.data.createBank(row.body));
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'saved', message: '' } : r)));
        saved++;
      } catch (err) {
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'failed', message: errorText(err) } : r)));
      }
    }
    this.importing.set(false);
    this.okMsg.set(`✅ Import finished: ${saved} bank${saved === 1 ? '' : 's'} added.`);
    this.load();
  }
}
