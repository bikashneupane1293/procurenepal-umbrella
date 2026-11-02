import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';

@Component({
  selector: 'app-certificates',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink],
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
            <label>Fiscal Year (BS) <span class="req">*</span></label>
            <select name="fiscalYear" [(ngModel)]="form.fiscalYear">
              @for (fy of fiscalYears; track fy) { <option [value]="fy">{{ fy }}</option> }
            </select>
          </div>
          <div>
            <label>Contract Amount (NPR) <span class="req">*</span></label>
            <input type="number" min="0" step="0.01" name="contractAmount" [(ngModel)]="form.contractAmount" placeholder="e.g. 45000000" />
          </div>
          <div>
            <label>Final Amount (NPR)</label>
            <input type="number" min="0" step="0.01" name="finalAmount" [(ngModel)]="form.finalAmount" placeholder="Amount actually completed" />
          </div>
          <div>
            <label>Price Adjustment (NPR)</label>
            <input type="number" step="0.01" name="priceAdjustment" [(ngModel)]="form.priceAdjustment" placeholder="0" />
          </div>
          <div>
            <label>JV Share (%)</label>
            <input type="number" min="0" max="100" step="0.01" name="jvShare" [(ngModel)]="form.jvShare" />
            <div class="help">100 if you did the work alone</div>
          </div>
          <div>
            <label>Completion Status</label>
            <select name="completionStatus" [(ngModel)]="form.completionStatus">
              <option value="completed">Completed</option>
              <option value="substantially_completed">Substantially completed</option>
              <option value="in_progress">In progress</option>
            </select>
          </div>
          <div>
            <label>Verification</label>
            <select name="verificationStatus" [(ngModel)]="form.verificationStatus">
              <option value="unverified">Not verified yet</option>
              <option value="verified">Verified</option>
            </select>
          </div>
          <div style="grid-column: 1 / -1">
            <label>Key Activities</label>
            <input name="activities" [(ngModel)]="form.activities" placeholder="e.g. Asphalt concrete, Gabion wall, RCC slab culvert" />
            <div class="help">Separate each activity with a comma</div>
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
                    @if (c.activities?.length) { <div class="help">{{ c.activities.join(', ') }}</div> }
                  </td>
                  <td>{{ companyName(c.companyId) }}</td>
                  <td><span class="tag">{{ c.projectType }}</span></td>
                  <td>{{ c.fiscalYear }}</td>
                  <td class="num">{{ toNum(c.contractAmount) | number: '1.0-2' }}</td>
                  <td class="num">{{ c.finalAmount != null ? (toNum(c.finalAmount) | number: '1.0-2') : '—' }}</td>
                  <td class="num">{{ toNum(c.jvShare) | number: '1.0-2' }}</td>
                  <td>
                    <span class="tag" [class.green]="c.completionStatus === 'completed'">{{ statusLabel(c.completionStatus) }}</span>
                    @if (c.verificationStatus === 'verified') { <span class="tag gold">Verified</span> }
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
  styles: [UI_STYLES, `.filter select { max-width: 360px; }`],
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

  form = this.emptyForm();

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
      contractAmount: null as number | null, finalAmount: null as number | null,
      priceAdjustment: null as number | null, jvShare: 100 as number | null,
      completionStatus: 'completed', verificationStatus: 'unverified', activities: '',
    };
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

  save() {
    const f = this.form;
    if (!f.companyId) { this.formError.set('Please choose the company.'); return; }
    if (!f.projectName.trim()) { this.formError.set('Please enter the project name.'); return; }
    if (f.contractAmount == null || (f.contractAmount as any) === '' || Number(f.contractAmount) < 0) {
      this.formError.set('Please enter the contract amount.'); return;
    }

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
    if (f.finalAmount != null && (f.finalAmount as any) !== '') body.finalAmount = Number(f.finalAmount);
    if (f.priceAdjustment != null && (f.priceAdjustment as any) !== '') body.priceAdjustment = Number(f.priceAdjustment);
    if (f.jvShare != null && (f.jvShare as any) !== '') body.jvShare = Number(f.jvShare);
    const acts = f.activities.split(',').map((a) => a.trim()).filter((a) => a);
    if (acts.length) body.activities = acts;

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
