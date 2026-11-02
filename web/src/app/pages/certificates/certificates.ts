import { Component, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';

interface ActivityRow { name: string; unit: string; fiscalYear: string; quantity: number | null; }

@Component({
  selector: 'app-certificates',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DatePipe, RouterLink],
  template: `
    <div class="bar">
      <div>
        <h1>Experience Certificates</h1>
        <p class="sub">Completed and ongoing works used for tender qualification</p>
      </div>
      @if (!showForm() && companies().length > 0) {
        <button class="btn gold" (click)="openForm()">+ Add Certificate</button>
      }
    </div>

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
        <h2>New Certificate</h2>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }

        <h3>1. Project details</h3>
        <div class="grid">
          <div>
            <label>Company <span class="req">*</span></label>
            <select name="formCompany" [(ngModel)]="form.companyId">
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
            <input name="certificateId" [(ngModel)]="form.certificateId" placeholder="Leave blank to auto-generate" />
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
          <div>
            <label>Project Start Date</label>
            <input type="date" name="startDate" [(ngModel)]="form.startDate" />
            <div class="help">Date in AD (English calendar)</div>
          </div>
          <div>
            <label>Project Completion Date</label>
            <input type="date" name="completionDate" [(ngModel)]="form.completionDate" />
            <div class="help">Date in AD (English calendar)</div>
          </div>
          <div>
            <label>Completion Status</label>
            <select name="completionStatus" [(ngModel)]="form.completionStatus">
              <option value="completed">Completed</option>
              <option value="substantially_completed">Substantially completed</option>
              <option value="in_progress">In progress</option>
            </select>
          </div>
        </div>

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
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save Certificate' }}</button>
          <button class="btn light" type="button" (click)="showForm.set(false)">Cancel</button>
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
                      <div class="help">📅 {{ c.startDate ? (c.startDate | date: 'dd MMM yyyy') : '?' }} → {{ c.completionDate ? (c.completionDate | date: 'dd MMM yyyy') : '?' }}</div>
                    }
                    @if (c.jvName) { <div class="help">🤝 {{ c.jvName }}</div> }
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
                  <td><button class="btn danger" (click)="remove(c)">Delete</button></td>
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

  // Nepali fiscal years, newest first: 2083/84 … 2070/71
  fiscalYears = Array.from({ length: 14 }, (_, i) => {
    const y = 2083 - i;
    return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
  });
  units = ['m³', 'm²', 'm', 'km', 'MT', 'kg', 'Nos', 'RM', 'LS', 'L', 'Set'];

  form = this.emptyForm();
  rows: ActivityRow[] = [];

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

  openForm() {
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
    if (f.employerName.trim()) body.employerName = f.employerName.trim();
    if (f.certificateId.trim()) body.certificateId = f.certificateId.trim();
    if (this.hasValue(f.finalAmount)) body.finalAmount = Number(f.finalAmount);
    if (this.hasValue(f.priceAdjustment)) body.priceAdjustment = Number(f.priceAdjustment);
    if (this.hasValue(f.jvShare)) body.jvShare = Number(f.jvShare);
    if (this.isJv()) body.jvName = f.jvName.trim();
    if (f.startDate) body.startDate = f.startDate;
    if (f.completionDate) body.completionDate = f.completionDate;
    if (keyActivities.length) {
      body.keyActivities = keyActivities;
      body.activities = [...new Set(keyActivities.map((a) => a.name))];
    }

    this.saving.set(true);
    this.formError.set('');
    this.data.createCertificate(f.companyId, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.okMsg.set(`✅ Certificate "${body.projectName}" was added.`);
        this.load();
      },
      error: (err) => { this.saving.set(false); this.formError.set(errorText(err)); },
    });
  }

  remove(c: any) {
    if (!confirm(`Delete the certificate "${c.projectName}"? This cannot be undone.`)) return;
    this.data.deleteCertificate(c.id).subscribe({
      next: () => { this.okMsg.set(`🗑️ "${c.projectName}" was deleted.`); this.load(); },
      error: (err) => this.loadError.set(errorText(err)),
    });
  }
}
