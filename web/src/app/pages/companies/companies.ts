import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { AuthService } from '../../core/auth.service';
import { DateField } from '../../shared/date-field';
import { showBoth } from '../../core/nepali-date';
import { ImportPanel } from '../../shared/import-panel';
import type { SheetRow } from '../../core/sheets';

const loadSheets = () => import('../../core/sheets');

// Excel/ZIP tools load only when needed
const loadExcel = () => import('../../core/excel');

@Component({
  selector: 'app-companies',
  standalone: true,
  imports: [FormsModule, RouterLink, DateField, ImportPanel],
  template: `
    <div class="bar">
      <div>
        <h1>Companies</h1>
        <p class="sub">Your construction companies (the firms that bid on tenders)</p>
      </div>
      <div class="tools">
        @if (companies().length) { <button class="btn light" (click)="exportExcel()">⬇ Export Excel</button> }
        <button class="btn light" (click)="template()">📄 Excel Template</button>
        <button class="btn light" (click)="fileInput.click()">⬆ Import Excel</button>
        <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
        @if (!showForm()) {
          <button class="btn gold" (click)="openForm()">+ Add Company</button>
        }
      </div>
    </div>

    @if (impRows().length || impError()) {
      <app-import-panel [rows]="impRows()" [headers]="['Company', 'Class', 'Licence expiry']" [fileName]="impFile()"
        [error]="impError()" [busy]="importing()" (run)="runImport()" (closed)="impRows.set([]); impError.set('')" />
    }

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }

    @if (confirmTarget(); as t) {
      <div class="panel danger-panel">
        <h2>Delete "{{ t.name }}"?</h2>
        <p>This will permanently delete the company <strong>and ALL of its experience certificates and saved qualification results</strong>. This cannot be undone.</p>
        <p><strong>Step 1 (recommended):</strong> download a ZIP backup first. It contains an Excel file you can import again later.</p>
        <div class="actions">
          <button class="btn gold" (click)="downloadZip(t)" [disabled]="zippingId() === t.id">
            {{ zippingId() === t.id ? 'Preparing ZIP…' : '⬇ Download ZIP backup' }}
          </button>
          @if (backupDoneId() === t.id) { <span class="tag green done">✓ Backup downloaded</span> }
        </div>
        <p style="margin-top:18px"><strong>Step 2:</strong> delete the company.</p>
        <div class="actions">
          <button class="btn del" (click)="removeCompany(t)" [disabled]="deletingId() === t.id">
            {{ deletingId() === t.id ? 'Deleting…' : (backupDoneId() === t.id ? 'Delete permanently' : 'Delete without backup') }}
          </button>
          <button class="btn light" (click)="confirmTarget.set(null)" [disabled]="deletingId() === t.id">Cancel</button>
        </div>
      </div>
    }

    @if (showForm()) {
      <form class="panel" (ngSubmit)="save()">
        <h2>{{ editId() ? 'Edit Company' : 'New Company' }}</h2>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }
        <div class="grid">
          <div>
            <label>Company Name <span class="req">*</span></label>
            <input name="name" [(ngModel)]="form.name" placeholder="e.g. Cuidado Construction Pvt. Ltd." required />
          </div>
          <div>
            <label>PAN / VAT No.</label>
            <input name="panVat" [(ngModel)]="form.panVat" placeholder="e.g. 601234567" />
          </div>
          <div>
            <label>License Class</label>
            <select name="licenseClass" [(ngModel)]="form.licenseClass">
              <option value="">— Select —</option>
              <option value="A">Class A</option>
              <option value="B">Class B</option>
              <option value="C">Class C</option>
              <option value="D">Class D</option>
            </select>
          </div>
          <app-date-field label="License Expiry Date" [(value)]="form.licenseExpiry" />
          <div>
            <label>Address</label>
            <input name="address" [(ngModel)]="form.address" placeholder="e.g. Baneshwor, Kathmandu" />
          </div>
        </div>
        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : (editId() ? 'Save Changes' : 'Save Company') }}</button>
          <button class="btn light" type="button" (click)="showForm.set(false); editId.set('')">Cancel</button>
        </div>
      </form>
    }

    @if (toCompany(); as tc) {
      <div class="panel">
        <div class="bar tight">
          <h2>Audited Annual Turnover — {{ tc.name }}</h2>
          <div class="tools">
            <button class="btn light small" type="button" (click)="exportTurnover(tc)">⬇ Export</button>
            <button class="btn light small" type="button" (click)="turnoverTemplate()">📄 Template</button>
            <button class="btn light small" type="button" (click)="toFile.click()">⬆ Import Excel</button>
            <input #toFile type="file" accept=".xlsx,.xls" hidden (change)="onTurnoverFile($event)" />
          </div>
        </div>
        <p class="help">Average annual construction turnover uses the best 3 of the last 10 fiscal years (WPI-adjusted). If this table is empty, turnover is estimated from certificates, which is less accurate.</p>
        @if (toError()) { <div class="msg error">{{ toError() }}</div> }
        @if (toLoading()) { <div class="msg info">Loading…</div> } @else {
          <div class="table-wrap">
            <table class="acts">
              <thead><tr><th style="width:30%">Fiscal Year</th><th class="num" style="width:40%">Turnover (NPR)</th><th style="width:20%">Source</th><th></th></tr></thead>
              <tbody>
                @for (row of toRows; track $index; let i = $index) {
                  <tr>
                    <td><select [name]="'tfy' + i" [(ngModel)]="row.fiscalYear">
                      @for (fy of fiscalYears; track fy) { <option [value]="fy">{{ fy }}</option> }
                    </select></td>
                    <td><input type="number" min="0" [name]="'tam' + i" [(ngModel)]="row.amount" class="right" placeholder="0" />
                      <div class="help tax">Enter taxable amount only (excluding VAT)</div></td>
                    <td><select [name]="'tsrc' + i" [(ngModel)]="row.source">
                      <option value="audited">Audited</option><option value="provisional">Provisional</option>
                    </select></td>
                    <td><button type="button" class="btn danger" (click)="toRows.splice(i, 1)">🗑️</button></td>
                  </tr>
                } @empty { <tr><td colspan="4" class="empty">No turnover entered yet.</td></tr> }
              </tbody>
            </table>
          </div>
          <div class="actions">
            <button class="btn light" type="button" (click)="addTurnoverRow()">+ Add Year</button>
            <button class="btn" type="button" (click)="saveTurnovers(tc)" [disabled]="toSaving()">{{ toSaving() ? 'Saving…' : 'Save Turnover' }}</button>
            <button class="btn light" type="button" (click)="toCompany.set(null)">Close</button>
          </div>
        }
      </div>
    }

    <div class="panel">
      @if (loading()) {
        <div class="msg info">Loading companies… (the first load can take up to a minute while the server wakes up)</div>
      } @else if (loadError()) {
        <div class="msg error">{{ loadError() }} <a class="link" (click)="load()">Try again</a></div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Company Name</th><th>PAN / VAT</th><th>License</th><th>License Expiry</th><th>Address</th><th></th></tr>
            </thead>
            <tbody>
              @for (c of companies(); track c.id) {
                <tr>
                  <td><strong>{{ c.name }}</strong></td>
                  <td>{{ c.panVat || '—' }}</td>
                  <td>@if (c.licenseClass) { <span class="tag gold">Class {{ c.licenseClass }}</span> } @else { — }</td>
                  <td>{{ both(c.licenseExpiry) }}</td>
                  <td>{{ c.address || '—' }}</td>
                  <td class="row-actions">
                    <a class="link" routerLink="/certificates" [queryParams]="{ company: c.id }">Certificates →</a>
                    <button class="btn light small" (click)="openTurnover(c)">Turnover</button>
                    <button class="btn light small" (click)="openEdit(c)">Edit</button>
                    @if (isOwner) {
                      <button class="btn light small" title="Download all data of this company as a ZIP file" [disabled]="zippingId() === c.id" (click)="downloadZip(c)">
                        {{ zippingId() === c.id ? '…' : '⬇ ZIP' }}
                      </button>
                      <button class="btn danger" (click)="askDelete(c)">Delete</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="empty">No companies yet. Click <strong>+ Add Company</strong> to add your first one.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [UI_STYLES, `
    .row-actions { white-space: nowrap; }
    .row-actions .btn { margin-left: 10px; }
    .btn.small { padding: 6px 12px; }
    .danger-panel { border: 2px solid #fecaca; background: #fffafa; }
    .danger-panel h2 { color: #b91c1c; }
    .danger-panel p { margin: 6px 0; color: #4b5563; }
    .btn.del { background: #dc2626; }
    .btn.del:hover { background: #b91c1c; }
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .bar.tight { margin-bottom: 6px; align-items: center; }
    .bar.tight h2 { margin: 0; }
    .done { align-self: center; font-size: 12px; padding: 6px 10px; }
    table.acts td { padding: 6px; border-bottom: 0; }
    input.right { text-align: right; }
    .help.tax { color: #b8860b; }
  `],
})
export class CompaniesPage {
  private data = inject(DataService);
  private auth = inject(AuthService);

  // Only the workspace Owner may download ZIP backups and delete companies
  isOwner = ['OWNER', 'SUPER_ADMIN'].includes(this.auth.getUser()?.role);
  deletingId = signal('');
  confirmTarget = signal<any | null>(null);
  zippingId = signal('');
  backupDoneId = signal('');

  companies = signal<any[]>([]);
  loading = signal(true);
  loadError = signal('');
  showForm = signal(false);
  saving = signal(false);
  formError = signal('');
  okMsg = signal('');

  form = this.emptyForm();
  editId = signal('');

  // Audited turnover editor
  toCompany = signal<any | null>(null);
  toRows: { fiscalYear: string; amount: number | null; source: string }[] = [];
  toLoading = signal(false);
  toSaving = signal(false);
  toError = signal('');
  fiscalYears = Array.from({ length: 14 }, (_, i) => {
    const y = 2083 - i;
    return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
  });

  constructor() {
    this.load();
  }

  emptyForm() {
    return { name: '', panVat: '', licenseClass: '', licenseExpiry: '', address: '' };
  }

  load() {
    this.loading.set(true);
    this.loadError.set('');
    this.data.getCompanies().subscribe({
      next: (list) => { this.companies.set(list); this.loading.set(false); },
      error: (err) => { this.loadError.set(errorText(err)); this.loading.set(false); },
    });
  }

  both(d: any) { return showBoth(d); }

  // ---------- Excel: companies ----------
  impRows = signal<SheetRow[]>([]);
  impError = signal('');
  impFile = signal('');
  importing = signal(false);

  async exportExcel() { (await loadSheets()).exportCompanies(this.companies()); }
  async template() { (await loadSheets()).companiesTemplate(); }

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
      const rows = await (await loadSheets()).readCompaniesFile(file, this.companies());
      this.impRows.set(rows);
      if (!rows.length) this.impError.set('No company rows found in the file.');
    } catch (err: any) {
      this.impError.set(err?.message || 'Could not read this file. Please use the Excel Template.');
    }
  }

  async runImport() {
    this.importing.set(true);
    let saved = 0;
    for (const row of this.impRows().filter((r) => r.status === 'ready')) {
      this.patchRow(row, { status: 'saving' });
      try {
        await firstValueFrom(this.data.createCompany(row.body));
        this.patchRow(row, { status: 'saved', message: '' });
        saved++;
      } catch (err) {
        this.patchRow(row, { status: 'failed', message: errorText(err) });
      }
    }
    this.importing.set(false);
    this.okMsg.set(`✅ Import finished: ${saved} compan${saved === 1 ? 'y' : 'ies'} added.`);
    this.load();
  }
  private patchRow(row: SheetRow, p: Partial<SheetRow>) {
    this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, ...p } : r)));
  }

  // ---------- Excel: turnover of one company ----------
  async exportTurnover(c: any) { (await loadSheets()).exportTurnover(c.name, this.toRows.filter((r) => r.amount !== null)); }
  async turnoverTemplate() { (await loadSheets()).turnoverTemplate(); }
  async onTurnoverFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.toError.set('');
    try {
      const { rows, errors } = await (await loadSheets()).readTurnoverFile(file);
      if (rows.length) this.toRows = rows.map((r) => ({ ...r }));
      this.toError.set(errors.length
        ? `${rows.length} year(s) read; ${errors.length} row(s) skipped: ${errors.join('; ')}`
        : '');
      if (rows.length) this.okMsg.set(`⬆ ${rows.length} year(s) read from ${file.name} — check them, then click Save Turnover.`);
      else if (!errors.length) this.toError.set('No turnover rows found in the file.');
    } catch (err: any) {
      this.toError.set(err?.message || 'Could not read this file. Please use the Template.');
    }
  }

  openEdit(c: any) {
    this.editId.set(c.id);
    this.form = {
      name: c.name ?? '', panVat: c.panVat ?? '', licenseClass: c.licenseClass ?? '',
      licenseExpiry: c.licenseExpiry ? String(c.licenseExpiry).slice(0, 10) : '', address: c.address ?? '',
    };
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  openTurnover(c: any) {
    this.toCompany.set(c);
    this.toError.set('');
    this.toLoading.set(true);
    this.data.getTurnovers(c.id).subscribe({
      next: (rows) => {
        this.toRows = rows.map((r: any) => ({ fiscalYear: r.fiscalYear, amount: Number(r.amount), source: r.source ?? 'audited' }));
        if (!this.toRows.length) this.addTurnoverRow();
        this.toLoading.set(false);
      },
      error: (err) => { this.toError.set(errorText(err)); this.toLoading.set(false); },
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  addTurnoverRow() {
    const used = new Set(this.toRows.map((r) => r.fiscalYear));
    const fy = this.fiscalYears.slice(1).find((y) => !used.has(y)) ?? this.fiscalYears[1];
    this.toRows.push({ fiscalYear: fy, amount: null, source: 'audited' });
  }

  saveTurnovers(c: any) {
    const rows = this.toRows.filter((r) => r.amount !== null && (r.amount as any) !== '');
    const fys = rows.map((r) => r.fiscalYear);
    if (new Set(fys).size !== fys.length) { this.toError.set('Each fiscal year can appear only once.'); return; }
    if (rows.some((r) => !(Number(r.amount) >= 0))) { this.toError.set('Turnover amounts must be 0 or more.'); return; }
    this.toSaving.set(true);
    this.toError.set('');
    this.data.saveTurnovers(c.id, rows.map((r) => ({ fiscalYear: r.fiscalYear, amount: Number(r.amount), source: r.source }))).subscribe({
      next: () => {
        this.toSaving.set(false);
        this.toCompany.set(null);
        this.okMsg.set(`✅ Turnover of "${c.name}" saved (${rows.length} year${rows.length === 1 ? '' : 's'}).`);
      },
      error: (err) => { this.toSaving.set(false); this.toError.set(errorText(err)); },
    });
  }

  openForm() {
    this.editId.set('');
    this.form = this.emptyForm();
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
  }

  askDelete(c: any) {
    this.okMsg.set('');
    this.backupDoneId.set('');
    this.confirmTarget.set(c);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async downloadZip(c: any) {
    if (!this.isOwner) return; // ZIP backup is for the workspace Owner only
    this.zippingId.set(c.id);
    try {
      const certs = await firstValueFrom(this.data.getCertificates(c.id));
      const turnovers = await firstValueFrom(this.data.getTurnovers(c.id)).catch(() => [] as any[]);
      const { downloadCompanyZip } = await loadExcel();
      await downloadCompanyZip(c, certs, turnovers);
      this.backupDoneId.set(c.id);
      if (!this.confirmTarget()) this.okMsg.set(`⬇ Backup of "${c.name}" downloaded (${certs.length} certificate${certs.length === 1 ? '' : 's'}).`);
    } catch (err) {
      this.loadError.set('Could not create the ZIP backup: ' + errorText(err));
    }
    this.zippingId.set('');
  }

  removeCompany(c: any) {
    this.deletingId.set(c.id);
    this.okMsg.set('');
    this.data.deleteCompany(c.id).subscribe({
      next: (res: any) => {
        this.deletingId.set('');
        this.confirmTarget.set(null);
        const n = res?.certificatesDeleted ?? 0;
        this.okMsg.set(`🗑️ "${c.name}" was deleted${n ? ` together with ${n} certificate${n === 1 ? '' : 's'}` : ''}.`);
        this.load();
      },
      error: (err) => { this.deletingId.set(''); this.confirmTarget.set(null); this.loadError.set(errorText(err)); },
    });
  }

  // "Cuidado Construction Pvt. Ltd." -> "cuidado-construction-pvt-ltd"
  private makeSlug(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
  }

  save() {
    const f = this.form;
    if (!f.name.trim()) { this.formError.set('Please enter the company name.'); return; }

    // Only send fields that have a value (the backend rejects empty extras)
    const editing = this.editId();
    const body: any = { name: f.name.trim() };
    if (!editing) body.slug = this.makeSlug(f.name);
    // On edit, blank fields are sent as null so they are cleared
    if (f.panVat.trim()) body.panVat = f.panVat.trim(); else if (editing) body.panVat = null;
    if (f.licenseClass) body.licenseClass = f.licenseClass; else if (editing) body.licenseClass = null;
    if (f.licenseExpiry) body.licenseExpiry = f.licenseExpiry; else if (editing) body.licenseExpiry = null;
    if (f.address.trim()) body.address = f.address.trim(); else if (editing) body.address = null;

    this.saving.set(true);
    this.formError.set('');
    const req = editing ? this.data.updateCompany(editing, body) : this.data.createCompany(body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.editId.set('');
        this.okMsg.set(editing ? `✅ "${body.name}" was updated.` : `✅ "${body.name}" was added.`);
        this.load();
      },
      error: (err) => { this.saving.set(false); this.formError.set(errorText(err)); },
    });
  }
}
