import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import type { ImportRow } from '../../core/excel';
import { DateField } from '../../shared/date-field';
import { adToBs } from '../../core/nepali-date';
import { PdfFill, PdfApply } from '../../shared/pdf-fill';

// The Excel tools are loaded only when needed, so the app stays fast
const loadExcel = () => import('../../core/excel');

interface ActivityRow { name: string; unit: string; fiscalYear: string; quantity: number | null; }

@Component({
  selector: 'app-certificates',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, DateField, PdfFill],
  template: `
    <div class="bar">
      <div>
        <h1>Experience Certificates</h1>
        <p class="sub">Completed and ongoing works used for tender qualification</p>
      </div>
      <div class="tools">
        @if (certificates().length > 0) {
          <button class="btn light" (click)="exportExcel()">⬇ Export Excel</button>
        }
        <button class="btn light" (click)="downloadTemplate()">📄 Excel Template</button>
        @if (companies().length > 0) {
          <button class="btn light" (click)="fileInput.click()">⬆ Import Excel</button>
          @if (!showForm()) {
            <button class="btn gold" (click)="openForm()">+ Add Certificate</button>
          }
        }
        <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
      </div>
    </div>

    @if (importRows().length > 0 || importError()) {
      <div class="panel">
        <h2>Import from Excel @if (importFileName()) { <small class="help">— {{ importFileName() }}</small> }</h2>
        @if (importError()) { <div class="msg error">{{ importError() }}</div> }
        @if (importRows().length > 0) {
          <div class="msg info">
            {{ readyCount() }} ready · {{ errorCount() }} with problems
            @if (savedCount() > 0) { · <strong>{{ savedCount() }} saved</strong> }
            @if (failedCount() > 0) { · {{ failedCount() }} failed }
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Row</th><th>Company</th><th>Project</th><th>FY</th><th class="num">Contract (NPR)</th><th class="num">Key activities</th><th>Status</th></tr></thead>
              <tbody>
                @for (r of importRows(); track r.rowNo) {
                  <tr>
                    <td>{{ r.rowNo }}</td>
                    <td>{{ r.companyName }}</td>
                    <td>{{ r.body.projectName }}</td>
                    <td>{{ r.body.fiscalYear }}</td>
                    <td class="num">{{ r.body.contractAmount | number: '1.0-2' }}</td>
                    <td class="num">{{ r.body.keyActivities?.length || 0 }}</td>
                    <td>
                      @switch (r.status) {
                        @case ('ready') { <span class="tag">Ready</span> }
                        @case ('saving') { <span class="tag gold">Saving…</span> }
                        @case ('saved') { <span class="tag green">Saved</span> }
                        @default { <span class="tag warn">{{ r.status === 'error' ? 'Fix in Excel' : 'Failed' }}</span> }
                      }
                      @if (r.message) { <div class="help err">{{ r.message }}</div> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <div class="actions">
          @if (readyCount() > 0 && !importing()) {
            <button class="btn" (click)="runImport()">Import {{ readyCount() }} certificate{{ readyCount() === 1 ? '' : 's' }}</button>
          }
          @if (importing()) { <button class="btn" disabled>Importing… {{ savedCount() + failedCount() }} / {{ importTotal() }}</button> }
          <button class="btn light" (click)="closeImport()" [disabled]="importing()">Close</button>
        </div>
      </div>
    }

    <div class="panel filter">
      <label>Show certificates of</label>
      <select [ngModel]="companyId()" (ngModelChange)="pickCompany($event)" name="companyFilter">
        <option value="">All companies</option>
        @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
      </select>
      @if (companiesLoaded() && companies().length === 0) {
        <div class="msg info" style="margin: 12px 0 0">
          You need a company first. <a class="link" routerLink="/companies">Add a company →</a>
        </div>
      }
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }

    @if (showForm()) {
      <form class="panel" (ngSubmit)="save()">
        <h2>{{ editId() ? 'Edit Certificate' : 'New Certificate' }}</h2>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }
        <app-pdf-fill kind="certificate" (filled)="fromPdf($event)" />
        @if (pdfMsg()) { <div class="msg ok">{{ pdfMsg() }}</div> }

        <h3>1. Project details</h3>
        <div class="grid">
          <div>
            <label>Company <span class="req">*</span></label>
            <select name="formCompany" [(ngModel)]="form.companyId" [disabled]="!!editId()">
              <option value="">— Select company —</option>
              @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select>
          </div>
          <div>
            <label>Project Name <span class="req">*</span></label>
            <input name="projectName" [(ngModel)]="form.projectName" placeholder="e.g. Upgrading of Dhulikhel–Sindhuli Road" />
          </div>
          <div>
            <label>Employer (Client)</label>
            <input name="employerName" [(ngModel)]="form.employerName" placeholder="e.g. Department of Roads" />
          </div>
          <div>
            <label>Certificate / Contract No.</label>
            <input name="certificateId" [(ngModel)]="form.certificateId" [placeholder]="editId() ? 'Leave blank to keep' : 'Leave blank to auto-generate'" />
          </div>
          <div>
            <label>Project Type <span class="req">*</span></label>
            <select name="projectType" [(ngModel)]="form.projectType">
              <option value="ROAD">Road</option>
              <option value="BUILDING">Building</option>
              <option value="IRRIGATION">Irrigation</option>
              <option value="BRIDGE">Bridge</option>
            </select>
          </div>
          <div>
            <label>Fiscal Year of Completion (BS) <span class="req">*</span></label>
            <select name="fiscalYear" [(ngModel)]="form.fiscalYear">
              @for (fy of fiscalYears; track fy) { <option [value]="fy">{{ fy }}</option> }
            </select>
          </div>
          <app-date-field label="Project Start Date" [(value)]="form.startDate" />
          <app-date-field [label]="form.completionStatus === 'in_progress' ? 'Scheduled Completion Date' : 'Project Completion Date'" [(value)]="form.completionDate" />
          <div>
            <label>Completion Status</label>
            <select name="completionStatus" [(ngModel)]="form.completionStatus">
              <option value="completed">Completed</option>
              <option value="substantially_completed">Substantially completed</option>
              <option value="in_progress">In progress</option>
            </select>
          </div>
        </div>
        @if (form.completionStatus === 'in_progress') {
          <div class="grid running">
            <div>
              <label>Remaining Work (NPR)</label>
              <input type="number" min="0" step="0.01" name="outstandingAmount" [(ngModel)]="form.outstandingAmount" placeholder="Value of work still to be done" />
              <div class="help tax">Enter taxable amount only (excluding VAT). Used for bid capacity (FIN-5 current commitments).</div>
            </div>
            <div>
              <label class="inline"><input type="checkbox" name="isOpenBid" [(ngModel)]="form.isOpenBid" /> Open-bid contract</label>
              <div class="help">Counts towards the running-contract limit (a bidder may not already hold 5). Untick only if the bid document excludes this contract.</div>
            </div>
          </div>
        }

        <h3>2. Amounts</h3>
        <div class="grid">
          <div>
            <label>Contract Amount (NPR) <span class="req">*</span></label>
            <input type="number" min="0" step="0.01" name="contractAmount" [(ngModel)]="form.contractAmount" placeholder="e.g. 45000000" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div>
          </div>
          <div>
            <label>Final Amount (NPR)</label>
            <input type="number" min="0" step="0.01" name="finalAmount" [(ngModel)]="form.finalAmount" placeholder="Amount actually completed" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div>
          </div>
          <div>
            <label>Price Adjustment (NPR)</label>
            <input type="number" step="0.01" name="priceAdjustment" [(ngModel)]="form.priceAdjustment" placeholder="0" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div>
          </div>
        </div>

        <h3>3. Joint Venture</h3>
        <div class="grid">
          <div>
            <label>Your JV Share (%)</label>
            <input type="number" min="0" max="100" step="0.01" name="jvShare" [(ngModel)]="form.jvShare" />
            <div class="help">100 if your company did the work alone</div>
          </div>
          @if (isJv()) {
            <div>
              <label>JV Name <span class="req">*</span></label>
              <input name="jvName" [(ngModel)]="form.jvName" placeholder="e.g. Cuidado–Sharma JV" />
              <div class="help">Name of the joint venture as written on the contract</div>
            </div>
          }
        </div>

        <h3>4. Key Activities (quantity completed in each fiscal year)</h3>
        <div class="table-wrap">
          <table class="acts">
            <thead>
              <tr><th style="width:38%">Item Name</th><th style="width:16%">Unit</th><th style="width:20%">Fiscal Year</th><th class="num" style="width:20%">Quantity</th><th></th></tr>
            </thead>
            <tbody>
              @for (row of rows; track $index; let i = $index) {
                <tr>
                  <td><input [name]="'actName' + i" [(ngModel)]="row.name" placeholder="e.g. Asphalt concrete" /></td>
                  <td>
                    <input [name]="'actUnit' + i" [(ngModel)]="row.unit" list="unitList" placeholder="m³" />
                  </td>
                  <td>
                    <select [name]="'actFy' + i" [(ngModel)]="row.fiscalYear">
                      @for (fy of fiscalYears; track fy) { <option [value]="fy">{{ fy }}</option> }
                    </select>
                  </td>
                  <td><input type="number" min="0" step="0.01" [name]="'actQty' + i" [(ngModel)]="row.quantity" placeholder="0" class="right" /></td>
                  <td><button type="button" class="btn danger" title="Remove this row" (click)="removeRow(i)">🗑️</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <datalist id="unitList">
          @for (u of units; track u) { <option [value]="u"></option> }
        </datalist>
        <button type="button" class="btn light addrow" (click)="addRow()">+ Add Row</button>
        <div class="help">Add one row per item per fiscal year. Example: Asphalt concrete · m³ · 2081/82 · 5200</div>

        <h3>5. Document Check</h3>
        <div class="grid">
          <div>
            <label>Has this certificate been checked against the employer's original?</label>
            <select name="verificationStatus" [(ngModel)]="form.verificationStatus">
              <option value="unverified">Not checked yet</option>
              <option value="verified">Checked against employer's original</option>
            </select>
            <div class="help">Tender evaluators may confirm experience with the employer. Unchecked certificates will be flagged in Qualification checks.</div>
          </div>
        </div>

        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : (editId() ? 'Save Changes' : 'Save Certificate') }}</button>
          <button class="btn light" type="button" (click)="showForm.set(false); editId.set('')">Cancel</button>
        </div>
      </form>
    }

    <div class="panel">
      @if (loading()) {
        <div class="msg info">Loading certificates… (the first load can take up to a minute while the server wakes up)</div>
      } @else if (loadError()) {
        <div class="msg error">{{ loadError() }} <a class="link" (click)="load()">Try again</a></div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Project</th><th>Company</th><th>Type</th><th>FY</th>
                <th class="num">Contract (NPR)</th><th class="num">Final (NPR)</th><th class="num">JV %</th>
                <th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of certificates(); track c.id) {
                <tr>
                  <td>
                    <strong>{{ c.projectName }}</strong>
                    <div class="help">{{ c.employerName || '' }}{{ c.employerName && c.certificateId ? ' · ' : '' }}{{ c.certificateId || '' }}</div>
                    @if (c.startDate || c.completionDate) {
                      <div class="help">📅 {{ bs(c.startDate) }} → {{ bs(c.completionDate) }} BS</div>
                    }
                    @if (c.jvName) { <div class="help">🤝 {{ c.jvName }}</div> }
                    @if (c.completionStatus === 'in_progress') {
                      <div class="help">⏳ Remaining: {{ c.outstandingAmount != null ? 'Rs ' + (toNum(c.outstandingAmount) | number: '1.0-0') : 'not entered' }}{{ c.isOpenBid === false ? ' · not counted in the 5-contract limit' : '' }}</div>
                    }
                    @if (c.keyActivities?.length) {
                      <table class="mini">
                        @for (a of c.keyActivities; track $index) {
                          <tr><td>{{ a.name }}</td><td>{{ a.fiscalYear }}</td><td class="num">{{ toNum(a.quantity) | number: '1.0-2' }} {{ a.unit }}</td></tr>
                        }
                      </table>
                    } @else if (c.activities?.length) {
                      <div class="help">{{ c.activities.join(', ') }}</div>
                    }
                  </td>
                  <td>{{ companyName(c.companyId) }}</td>
                  <td><span class="tag">{{ c.projectType }}</span></td>
                  <td>{{ c.fiscalYear }}</td>
                  <td class="num">{{ toNum(c.contractAmount) | number: '1.0-2' }}</td>
                  <td class="num">{{ c.finalAmount != null ? (toNum(c.finalAmount) | number: '1.0-2') : '—' }}</td>
                  <td class="num">{{ toNum(c.jvShare) | number: '1.0-2' }}</td>
                  <td>
                    <span class="tag" [class.green]="c.completionStatus === 'completed'">{{ statusLabel(c.completionStatus) }}</span>
                    @if (c.verificationStatus === 'verified') { <span class="tag gold">Checked</span> }
                    @else { <span class="tag warn">Not checked</span> }
                  </td>
                  <td class="row-actions"><button class="btn light small" (click)="openEdit(c)">Edit</button> <button class="btn danger" (click)="remove(c)">Delete</button></td>
                </tr>
              } @empty {
                <tr><td colspan="9" class="empty">No certificates yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [UI_STYLES, `
    .filter select { max-width: 360px; }
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: 0.04em; margin: 22px 0 10px; padding-top: 14px; border-top: 1px solid #eef0f2; }
    form h3:first-of-type { border-top: 0; padding-top: 0; margin-top: 4px; }
    .help.tax { color: #b8860b; }
    table.acts td { padding: 6px; border-bottom: 0; }
    table.acts th { padding: 8px 6px; }
    table.acts input, table.acts select { padding: 8px 10px; }
    input.right { text-align: right; }
    .addrow { margin: 6px 0 4px; }
    table.mini { margin-top: 6px; font-size: 12px; width: auto; }
    table.mini td { padding: 2px 10px 2px 0; border: 0; color: #4b5563; }
    .tag.warn { background: #fef2f2; color: #b91c1c; }
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .help.err { color: #b91c1c; max-width: 420px; }
    .grid.running { margin-top: 14px; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; }
    label.inline input { width: auto; }
    .row-actions { white-space: nowrap; }
    .btn.small { padding: 6px 12px; }
  `],
})
export class CertificatesPage {
  private data = inject(DataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  companies = signal<any[]>([]);
  companiesLoaded = signal(false);
  companyId = signal('');
  certificates = signal<any[]>([]);
  loading = signal(true);
  loadError = signal('');
  showForm = signal(false);
  saving = signal(false);
  formError = signal('');
  okMsg = signal('');

  // Excel import state
  importRows = signal<ImportRow[]>([]);
  importError = signal('');
  importFileName = signal('');
  importing = signal(false);
  importTotal = signal(0);
  readyCount = computed(() => this.importRows().filter((r) => r.status === 'ready').length);
  errorCount = computed(() => this.importRows().filter((r) => r.status === 'error').length);
  savedCount = computed(() => this.importRows().filter((r) => r.status === 'saved').length);
  failedCount = computed(() => this.importRows().filter((r) => r.status === 'failed').length);

  // Nepali fiscal years, newest first: 2083/84 … 2070/71
  fiscalYears = Array.from({ length: 14 }, (_, i) => {
    const y = 2083 - i;
    return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
  });
  units = ['m³', 'm²', 'm', 'km', 'MT', 'kg', 'Nos', 'RM', 'LS', 'L', 'Set'];

  form = this.emptyForm();
  rows: ActivityRow[] = [];
  editId = signal('');

  constructor() {
    this.companyId.set(this.route.snapshot.queryParamMap.get('company') || '');
    this.data.getCompanies().subscribe({
      next: (list) => { this.companies.set(list); this.companiesLoaded.set(true); },
      error: () => this.companiesLoaded.set(true),
    });
    this.load();
  }

  emptyForm() {
    return {
      companyId: '', projectName: '', employerName: '', certificateId: '',
      projectType: 'ROAD', fiscalYear: this.fiscalYears?.[1] ?? '2082/83',
      startDate: '', completionDate: '',
      contractAmount: null as number | null, finalAmount: null as number | null,
      priceAdjustment: null as number | null, jvShare: 100 as number | null, jvName: '',
      completionStatus: 'completed', verificationStatus: 'unverified',
      outstandingAmount: null as number | null, isOpenBid: true,
    };
  }

  newRow(): ActivityRow {
    return { name: '', unit: '', fiscalYear: this.form.fiscalYear, quantity: null };
  }
  addRow() { this.rows.push(this.newRow()); }
  removeRow(i: number) {
    this.rows.splice(i, 1);
    if (this.rows.length === 0) this.rows.push(this.newRow());
  }

  isJv(): boolean {
    const v = this.form.jvShare as any;
    return v !== null && v !== '' && Number(v) < 100;
  }

  load() {
    this.loading.set(true);
    this.loadError.set('');
    this.data.getCertificates(this.companyId() || undefined).subscribe({
      next: (list) => { this.certificates.set(list); this.loading.set(false); },
      error: (err) => { this.loadError.set(errorText(err)); this.loading.set(false); },
    });
  }

  pickCompany(id: string) {
    this.companyId.set(id);
    this.router.navigate([], { queryParams: { company: id || null } });
    this.load();
  }

  pdfMsg = signal('');
  fromPdf(p: PdfApply) {
    const f: any = this.form;
    for (const [k, v] of Object.entries(p.fields)) if (k in f) f[k] = v;
    if (p.fields['fiscalYear'] && !this.fiscalYears.includes(p.fields['fiscalYear'])) f.fiscalYear = this.form.fiscalYear;
    if (p.activities.length) {
      const fy = this.form.fiscalYear;
      const keep = this.rows.filter((r) => r.name.trim());
      this.rows = [...keep, ...p.activities.map((a) => ({ name: a.name, unit: a.unit, fiscalYear: fy, quantity: a.quantity }))];
    }
    this.pdfMsg.set(`📄 ${Object.keys(p.fields).length} field(s) and ${p.activities.length} key activit${p.activities.length === 1 ? 'y' : 'ies'} filled from ${p.fileName}. Key activity fiscal years are set to ${this.form.fiscalYear} — change them if the work was spread over years. Check every value against the PDF before saving.`);
  }

  bs(d: any): string { return d ? adToBs(String(d).slice(0, 10)) || '?' : '?'; }

  openEdit(c: any) {
    const n = (v: any) => (v == null || v === '' ? null : Number(v));
    const d = (v: any) => (v ? String(v).slice(0, 10) : '');
    this.editId.set(c.id);
    this.form = {
      companyId: c.companyId, projectName: c.projectName ?? '', employerName: c.employerName ?? '',
      certificateId: c.certificateId ?? '', projectType: c.projectType ?? 'ROAD', fiscalYear: c.fiscalYear,
      startDate: d(c.startDate), completionDate: d(c.completionDate),
      contractAmount: n(c.contractAmount), finalAmount: n(c.finalAmount), priceAdjustment: n(c.priceAdjustment),
      jvShare: n(c.jvShare) ?? 100, jvName: c.jvName ?? '',
      completionStatus: c.completionStatus ?? 'completed', verificationStatus: c.verificationStatus ?? 'unverified',
      outstandingAmount: n(c.outstandingAmount), isOpenBid: c.isOpenBid !== false,
    };
    this.rows = (Array.isArray(c.keyActivities) && c.keyActivities.length ? c.keyActivities : [null]).map((a: any) =>
      a ? { name: a.name ?? '', unit: a.unit ?? '', fiscalYear: a.fiscalYear ?? c.fiscalYear, quantity: n(a.quantity) } : this.newRow());
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  openForm() {
    this.pdfMsg.set('');
    this.editId.set('');
    this.form = this.emptyForm();
    this.form.companyId = this.companyId();
    this.rows = [this.newRow()];
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
  }

  companyName(id: string): string {
    return this.companies().find((c) => c.id === id)?.name ?? '—';
  }
  toNum(v: any): number {
    return v == null || v === '' ? 0 : Number(v);
  }
  statusLabel(s: string): string {
    return s === 'completed' ? 'Completed' : s === 'substantially_completed' ? 'Substantially completed' : 'In progress';
  }
  private hasValue(v: any): boolean {
    return v !== null && v !== undefined && v !== '';
  }

  save() {
    const f = this.form;
    if (!f.companyId) { this.formError.set('Please choose the company.'); return; }
    if (!f.projectName.trim()) { this.formError.set('Please enter the project name.'); return; }
    if (!this.hasValue(f.contractAmount) || Number(f.contractAmount) < 0) {
      this.formError.set('Please enter the contract amount.'); return;
    }
    if (this.isJv() && !f.jvName.trim()) {
      this.formError.set('Your JV share is below 100%. Please enter the JV name.'); return;
    }
    if (f.startDate && f.completionDate && f.completionDate < f.startDate) {
      this.formError.set('Completion date cannot be before the start date.'); return;
    }

    // Key activity rows: skip fully empty rows, check the rest are complete
    const filled = this.rows.filter((r) => r.name.trim() || r.unit.trim() || this.hasValue(r.quantity));
    for (const [i, r] of filled.entries()) {
      if (!r.name.trim() || !r.unit.trim() || !this.hasValue(r.quantity) || !r.fiscalYear) {
        this.formError.set(`Key activity row ${i + 1}: please fill Item Name, Unit, Fiscal Year and Quantity (or delete the row).`);
        return;
      }
    }
    const keyActivities = filled.map((r) => ({
      name: r.name.trim(), unit: r.unit.trim(), fiscalYear: r.fiscalYear, quantity: Number(r.quantity),
    }));

    // Only send fields that have a value; numbers must be real numbers
    const body: any = {
      projectName: f.projectName.trim(),
      contractAmount: Number(f.contractAmount),
      fiscalYear: f.fiscalYear,
      projectType: f.projectType,
      completionStatus: f.completionStatus,
      verificationStatus: f.verificationStatus,
    };
    const editing = this.editId();
    // On edit, blank optional fields are sent as null so they are cleared
    const clear = (k: string) => { if (editing) body[k] = null; };
    if (f.employerName.trim()) body.employerName = f.employerName.trim(); else clear('employerName');
    if (f.certificateId.trim()) body.certificateId = f.certificateId.trim();
    if (this.hasValue(f.finalAmount)) body.finalAmount = Number(f.finalAmount); else clear('finalAmount');
    if (this.hasValue(f.priceAdjustment)) body.priceAdjustment = Number(f.priceAdjustment); else if (editing) body.priceAdjustment = 0;
    if (this.hasValue(f.jvShare)) body.jvShare = Number(f.jvShare);
    if (this.isJv()) body.jvName = f.jvName.trim(); else clear('jvName');
    if (f.startDate) body.startDate = f.startDate; else clear('startDate');
    if (f.completionDate) body.completionDate = f.completionDate; else clear('completionDate');
    if (f.completionStatus === 'in_progress') {
      if (this.hasValue(f.outstandingAmount)) {
        if (Number(f.outstandingAmount) < 0) { this.formError.set('Remaining work cannot be negative.'); return; }
        body.outstandingAmount = Number(f.outstandingAmount);
      } else clear('outstandingAmount');
      body.isOpenBid = !!f.isOpenBid;
    } else if (editing) {
      body.outstandingAmount = null;
    }
    if (keyActivities.length || editing) {
      body.keyActivities = keyActivities;
      body.activities = [...new Set(keyActivities.map((a) => a.name))];
    }

    this.saving.set(true);
    this.formError.set('');
    const req = editing ? this.data.updateCertificate(editing, body) : this.data.createCertificate(f.companyId, body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.editId.set('');
        this.okMsg.set(editing ? `✅ Certificate "${body.projectName}" was updated.` : `✅ Certificate "${body.projectName}" was added.`);
        this.load();
      },
      error: (err) => { this.saving.set(false); this.formError.set(errorText(err)); },
    });
  }

  // ---------- Excel ----------
  async exportExcel() {
    const { exportCertificates } = await loadExcel();
    const name = this.companyId() ? this.companyName(this.companyId()).replace(/[^A-Za-z0-9]+/g, '_') : 'All';
    const date = new Date().toISOString().slice(0, 10);
    exportCertificates(this.certificates(), (id) => this.companyName(id), `ProcureNepal_Certificates_${name}_${date}.xlsx`);
  }

  async downloadTemplate() {
    const { downloadTemplate } = await loadExcel();
    downloadTemplate();
  }

  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow choosing the same file again
    if (!file) return;
    this.showForm.set(false);
    this.okMsg.set('');
    this.importError.set('');
    this.importRows.set([]);
    this.importFileName.set(file.name);
    try {
      const { readImportFile } = await loadExcel();
      // Load ALL saved certificates so duplicates can be skipped
      const existing = await firstValueFrom(this.data.getCertificates()).catch(() => [] as any[]);
      const rows = await readImportFile(file, this.companies(), existing);
      this.importRows.set(rows);
      if (rows.length === 0) this.importError.set('No certificate rows found in the file.');
    } catch (e: any) {
      this.importError.set(e?.message || 'Could not read this file. Please use the Excel Template.');
    }
  }

  async runImport() {
    const todo = this.importRows().filter((r) => r.status === 'ready');
    this.importing.set(true);
    this.importTotal.set(todo.length);
    for (const row of todo) {
      this.updateRow(row, { status: 'saving', message: '' });
      try {
        await firstValueFrom(this.data.createCertificate(row.companyId, row.body));
        this.updateRow(row, { status: 'saved', message: '' });
      } catch (err) {
        this.updateRow(row, { status: 'failed', message: errorText(err) });
      }
    }
    this.importing.set(false);
    this.okMsg.set(`✅ Import finished: ${this.savedCount()} saved${this.failedCount() ? `, ${this.failedCount()} failed` : ''}.`);
    this.load();
  }

  private updateRow(row: ImportRow, patch: Partial<ImportRow>) {
    this.importRows.update((list) => list.map((r) => (r.rowNo === row.rowNo ? { ...r, ...patch } : r)));
  }

  closeImport() {
    this.importRows.set([]);
    this.importError.set('');
    this.importFileName.set('');
  }

  remove(c: any) {
    if (!confirm(`Delete the certificate "${c.projectName}"? This cannot be undone.`)) return;
    this.data.deleteCertificate(c.id).subscribe({
      next: () => { this.okMsg.set(`🗑️ "${c.projectName}" was deleted.`); this.load(); },
      error: (err) => this.loadError.set(errorText(err)),
    });
  }
}
