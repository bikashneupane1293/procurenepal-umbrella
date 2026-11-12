import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { DateField } from '../../shared/date-field';
import { ImportPanel } from '../../shared/import-panel';
import { adToBs } from '../../core/nepali-date';
import type { SheetRow } from '../../core/sheets';

const loadSheets = () => import('../../core/project-sheets');

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planned', MOBILIZING: 'Mobilizing', ONGOING: 'Ongoing', SUSPENDED: 'Suspended',
  COMPLETED: 'Completed', HANDED_OVER: 'Handed over', CLOSED: 'Closed', TERMINATED: 'Terminated',
};
const ACTIVE = ['PLANNED', 'MOBILIZING', 'ONGOING', 'SUSPENDED'];

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, DateField, ImportPanel],
  template: `
    <div class="bar">
      <div>
        <h1>{{ boqMode ? 'BOQ Management — Excel Upload' : 'Project Information' }}</h1>
        <p class="sub">{{ boqMode
          ? 'Choose a project to open its Bill of Quantities. Upload the BOQ from Excel — the template, or the BOQ sheet straight from the tender document.'
          : 'Contracts being executed. A bid marked "Contract signed" becomes a project by itself, with its contract data and bank guarantees.' }}</p>
      </div>
      <div class="tools">
        @if (list().length) { <button class="btn light" (click)="exportExcel()">⬇ Export Excel</button> }
        <button class="btn light" (click)="template()">📄 Excel Template</button>
        <button class="btn light" (click)="fileInput.click()">⬆ Import Excel</button>
        <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
        @if (boqMode) { <button class="btn light" (click)="boqTemplate()">📄 BOQ Template</button> }
        @if (!showNew()) { <button class="btn gold" (click)="openNew()">+ New Project</button> }
      </div>
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }
    @if (error()) { <div class="msg error">{{ error() }}</div> }

    @if (impRows().length || impError()) {
      <app-import-panel [rows]="impRows()" [headers]="['Company', 'Code', 'Project', 'Contract (NPR)']" [fileName]="impFile()"
        [error]="impError()" [busy]="importing()" (run)="runImport()" (closed)="impRows.set([]); impError.set('')" />
    }

    @if (won().length) {
      <section class="panel wonp">
        <h2>🏆 Won bids without a project ({{ won().length }})</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Tender</th><th>Company</th><th>Status</th><th class="num">Contract / bid (NPR)</th><th></th></tr></thead>
          <tbody>
            @for (b of won(); track b.id) {
              <tr>
                <td><strong>{{ b.tender?.ifbNumber }}</strong><div class="help">{{ b.tender?.projectTitle }}</div></td>
                <td>{{ b.company?.name }}</td>
                <td>{{ b.status === 'AWARDED' ? 'Awarded' : 'Contract signed' }}</td>
                <td class="num">{{ num(b.contractAmount ?? b.bidAmount) | number: '1.0-0' }}</td>
                <td><button class="btn small" (click)="fromBid(b)" [disabled]="busyBid() === b.id">{{ busyBid() === b.id ? 'Creating…' : 'Create project →' }}</button></td>
              </tr>
            }
          </tbody>
        </table></div>
        <p class="help">Awarded bids wait for you; a bid marked "Contract signed" is turned into a project automatically.</p>
      </section>
    }

    @if (showNew()) {
      <form class="panel" (ngSubmit)="create()">
        <div class="bar tight"><h2>New project</h2><button type="button" class="btn light small" (click)="showNew.set(false)">Close</button></div>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }
        <div class="grid">
          <div><label>Contractor company <span class="req">*</span></label>
            <select name="companyId" [(ngModel)]="f.companyId">
              <option value="">— Select company —</option>
              @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select></div>
          <div class="wide"><label>Project name <span class="req">*</span></label><input name="name" [(ngModel)]="f.name" /></div>
          <div><label>Project code</label><input name="code" [(ngModel)]="f.code" placeholder="Blank = next free (P-001 …)" /></div>
          <div><label>Client / employer</label><input name="client" [(ngModel)]="f.client" /></div>
          <div><label>Location</label><input name="location" [(ngModel)]="f.location" placeholder="District / municipality" /></div>
          <div><label>Contract No.</label><input name="contractNo" [(ngModel)]="f.contractNo" /></div>
          <div><label>Type</label>
            <select name="projectType" [(ngModel)]="f.projectType">
              <option value="">—</option>@for (t of types; track t) { <option [value]="t">{{ t }}</option> }
            </select></div>
          <div><label>Contract amount (NPR)</label><input type="number" min="0" name="contractAmount" [(ngModel)]="f.contractAmount" />
            <div class="help tax">Taxable amount only (excluding VAT)</div></div>
          <app-date-field label="Start (commencement) date" [(value)]="f.startDate" />
          <div><label>Contract period (months)</label><input type="number" min="1" max="240" name="contractPeriodMonths" [(ngModel)]="f.contractPeriodMonths" />
            <div class="help">Intended completion = start + months</div></div>
          <div><label>Status</label>
            <select name="status" [(ngModel)]="f.status">@for (s of statuses; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }</select></div>
        </div>
        <div class="actions"><button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Create project' }}</button></div>
      </form>
    }

    @if (!boqMode) {
      <section class="cards">
        <div class="card"><div class="label">Active projects</div><div class="value">{{ stats().active }}</div><div class="hint">{{ list().length }} in total</div></div>
        <div class="card"><div class="label">Active contract value</div><div class="value small">Rs {{ stats().value | number: '1.0-0' }}</div><div class="hint">excluding VAT</div></div>
        <div class="card"><div class="label">BOQ uploaded</div><div class="value">{{ stats().withBoq }}</div><div class="hint">of {{ stats().active }} active</div></div>
        <div class="card"><div class="label">Need attention</div><div class="value" [class.warn]="stats().alerts">{{ stats().alerts }}</div><div class="hint">overdue, BOQ, guarantees</div></div>
      </section>
    }

    <div class="panel">
      <div class="filters">
        <select name="fs" [ngModel]="fStatus()" (ngModelChange)="fStatus.set($event)">
          <option value="ACTIVE">Active (planned → suspended)</option>
          <option value="">All statuses</option>
          @for (s of statuses; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
        </select>
        <select name="fc" [ngModel]="fCompany()" (ngModelChange)="fCompany.set($event)">
          <option value="">All companies</option>
          @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
        <input name="fq" placeholder="Search code / name / client" [ngModel]="fText()" (ngModelChange)="fText.set($event)" />
      </div>
      @if (loading()) { <div class="msg info">Loading projects…</div> }
      @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Project</th><th>Company</th><th class="num">Contract (NPR)</th><th>Completion</th><th>Time used</th><th class="num">BOQ</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (p of filtered(); track p.id) {
                <tr>
                  <td><strong>{{ p.code }}</strong>@if (p.source === 'BID') { <div class="help">from bid</div> }</td>
                  <td>{{ p.name }}<div class="help">{{ p.client }}{{ p.location ? ' · ' + p.location : '' }}</div>
                    @for (a of p.alerts; track $index) { <div class="al">⚠ {{ a.message }}</div> }</td>
                  <td>{{ p.company?.name }}@if (p.bidderType === 'JV') { <span class="tag gold">JV</span> }</td>
                  <td class="num">{{ p.contractAmount != null ? (num(p.contractAmount) | number: '1.0-0') : '—' }}</td>
                  <td>@if (due(p); as d) { {{ bs(d) }} @if (active(p.status)) { <span class="days" [class.warn]="p.daysToCompletion < 30">{{ daysText(p.daysToCompletion) }}</span> } } @else { — }</td>
                  <td>@if (p.timeUsedPct != null) { <div class="meter"><span [style.width.%]="min100(p.timeUsedPct)" [class.over]="p.timeUsedPct > 100"></span></div><span class="help">{{ p.timeUsedPct }}%</span> } @else { — }</td>
                  <td class="num">{{ p.boqCount ? (p.boqCount + ' lines') : '—' }}</td>
                  <td><span class="st" [class]="'st ' + p.status">{{ statusLabel(p.status) }}</span></td>
                  <td><a class="btn light small" [routerLink]="['/projects', p.id]" [queryParams]="boqMode ? { tab: 'boq' } : {}">{{ boqMode ? 'Open BOQ' : 'Open' }}</a></td>
                </tr>
              } @empty { <tr><td colspan="9" class="empty">No projects here. Mark a won bid as "Contract signed", click <strong>Create project →</strong> above, or <strong>+ New Project</strong>.</td></tr> }
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
    .btn.small { padding: 6px 12px; text-decoration: none; display: inline-block; }
    .wide { grid-column: span 2; }
    .help.tax { color: #b8860b; }
    .wonp { border-color: #f5d98a; background: #fffdf5; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 16px; }
    .card .label { color: #4b5563; font-size: 13px; }
    .card .value { font-size: 28px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .card .value.small { font-size: 18px; }
    .card .value.warn { color: #b8860b; }
    .card .hint { font-size: 12px; color: #9ca3af; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .filters select, .filters input { width: auto; min-width: 180px; }
    .st { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 10px; background: #e8eef6; color: #1e3a5f; white-space: nowrap; }
    .st.ONGOING, .st.MOBILIZING { background: #dcfce7; color: #15803d; }
    .st.SUSPENDED, .st.PLANNED { background: #fef5e0; color: #8a6508; }
    .st.TERMINATED { background: #fee2e2; color: #b91c1c; }
    .st.COMPLETED, .st.HANDED_OVER, .st.CLOSED { background: #f3f4f6; color: #4b5563; }
    .al { font-size: 12px; color: #8a6508; margin-top: 2px; }
    .days { font-size: 11px; color: #6b7280; display: block; }
    .days.warn { color: #b91c1c; font-weight: 700; }
    .meter { width: 80px; height: 8px; background: #eef0f2; border-radius: 4px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px; }
    .meter span { display: block; height: 100%; background: #1e3a5f; }
    .meter span.over { background: #b91c1c; }
    @media (max-width: 700px) { .wide { grid-column: auto; } }
  `],
})
export class ProjectsPage {
  private data = inject(DataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  boqMode = !!this.route.snapshot.data['boq'];
  statuses = Object.keys(PROJECT_STATUS_LABEL);
  types = ['ROAD', 'BUILDING', 'IRRIGATION', 'BRIDGE', 'WATER SUPPLY', 'HYDROPOWER', 'OTHER'];

  list = signal<any[]>([]);
  won = signal<any[]>([]);
  companies = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  okMsg = signal('');
  formError = signal('');
  saving = signal(false);
  showNew = signal(false);
  busyBid = signal('');
  fStatus = signal('ACTIVE');
  fCompany = signal('');
  fText = signal('');
  f: any = {};

  filtered = computed(() => {
    const q = this.fText().trim().toLowerCase();
    return this.list().filter((p) =>
      (!this.fStatus() || (this.fStatus() === 'ACTIVE' ? ACTIVE.includes(p.status) : p.status === this.fStatus())) &&
      (!this.fCompany() || p.companyId === this.fCompany()) &&
      (!q || `${p.code} ${p.name} ${p.client ?? ''}`.toLowerCase().includes(q)));
  });
  stats = computed(() => {
    const act = this.list().filter((p) => ACTIVE.includes(p.status));
    return {
      active: act.length,
      value: act.reduce((t, p) => t + this.num(p.contractAmount), 0),
      withBoq: act.filter((p) => p.boqCount).length,
      alerts: this.list().filter((p) => p.alerts?.length).length,
    };
  });

  constructor() {
    this.load();
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: () => {} });
  }

  statusLabel(s: string) { return PROJECT_STATUS_LABEL[s] ?? s; }
  active(s: string) { return ACTIVE.includes(s); }
  num(v: any) { return v == null ? 0 : Number(v); }
  min100(v: number) { return Math.min(100, Math.max(0, v)); }
  bs(d: any) { return d ? adToBs(String(d).slice(0, 10)) : ''; }
  due(p: any) { return p.actualCompletionDate ?? p.revisedCompletionDate ?? p.intendedCompletionDate; }
  daysText(n: number | null) { return n == null ? '' : n < 0 ? `${-n}d overdue` : `${n}d left`; }

  load() {
    this.loading.set(true);
    this.data.getProjects().subscribe({
      next: (l) => { this.list.set(l); this.loading.set(false); },
      error: (e) => { this.error.set(errorText(e)); this.loading.set(false); },
    });
    this.data.getWonBids().subscribe({ next: (l) => this.won.set(l), error: () => {} });
  }

  openNew() {
    this.f = { companyId: this.fCompany() || (this.companies().length === 1 ? this.companies()[0].id : ''), name: '', code: '', client: '', location: '', contractNo: '', projectType: '', contractAmount: null, startDate: '', contractPeriodMonths: null, status: 'ONGOING' };
    this.formError.set('');
    this.okMsg.set('');
    this.showNew.set(true);
  }

  async create() {
    this.formError.set('');
    if (!this.f.companyId || !String(this.f.name).trim()) { this.formError.set('Choose the company and type the project name.'); return; }
    const body: any = { companyId: this.f.companyId, name: String(this.f.name).trim(), status: this.f.status };
    for (const k of ['code', 'client', 'location', 'contractNo', 'projectType']) if (String(this.f[k] ?? '').trim()) body[k] = String(this.f[k]).trim();
    if (this.f.startDate) body.startDate = this.f.startDate;
    for (const k of ['contractAmount', 'contractPeriodMonths']) {
      const v = this.f[k];
      if (v === null || v === '' || v === undefined) continue;
      const n = Number(v);
      if (!isFinite(n) || n < 0) { this.formError.set('Please check the amount and the period.'); return; }
      body[k] = k === 'contractPeriodMonths' ? Math.max(1, Math.round(n)) : n;
    }
    this.saving.set(true);
    try {
      const p = await firstValueFrom(this.data.createProject(body));
      this.router.navigate(['/projects', p.id]);
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }

  async fromBid(b: any) {
    this.busyBid.set(b.id);
    this.error.set('');
    try {
      const p = await firstValueFrom(this.data.createProjectFromBid(b.id));
      this.router.navigate(['/projects', p.id], { queryParams: { created: 1 } });
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.busyBid.set('');
  }

  // ---------- Excel ----------
  impRows = signal<SheetRow[]>([]);
  impError = signal('');
  impFile = signal('');
  importing = signal(false);
  async exportExcel() { (await loadSheets()).exportProjects(this.filtered()); }
  async template() { (await loadSheets()).projectsTemplate(); }
  async boqTemplate() { (await loadSheets()).boqTemplate(); }
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
      const rows = await (await loadSheets()).readProjectsFile(file, this.companies(), this.list());
      this.impRows.set(rows);
      if (!rows.length) this.impError.set('No project rows found in the file.');
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
        await firstValueFrom(this.data.createProject(row.body));
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'saved', message: '' } : r)));
        saved++;
      } catch (err) {
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'failed', message: errorText(err) } : r)));
      }
    }
    this.importing.set(false);
    this.okMsg.set(`✅ Import finished: ${saved} project${saved === 1 ? '' : 's'} added.`);
    this.load();
  }
}
