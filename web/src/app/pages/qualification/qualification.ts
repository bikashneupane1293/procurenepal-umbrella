import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { QualResult, verdictText } from '../../shared/qual-result';

const loadReport = () => import('../../core/report');

@Component({
  selector: 'app-qualification',
  standalone: true,
  imports: [FormsModule, RouterLink, QualResult],
  template: `
    <h1>Qualification Check</h1>
    <p class="sub">Check one, several or all of your companies against a saved tender, or try quick numbers before you add the tender.</p>

    <div class="panel">
      <div class="tabs">
        <button class="tab" [class.on]="mode() === 'tender'" (click)="mode.set('tender')">Against a saved tender</button>
        <button class="tab" [class.on]="mode() === 'quick'" (click)="mode.set('quick')">Quick numbers</button>
      </div>
      @if (error()) { <div class="msg error">{{ error() }}</div> }

      @if (mode() === 'tender') {
        <div class="grid">
          <div><label>Tender <span class="req">*</span></label>
            <select name="t" [(ngModel)]="tenderId">
              <option value="">— Select tender —</option>
              @for (t of tenders(); track t.id) { <option [value]="t.id">{{ t.ifbNumber }} — {{ t.projectTitle }}</option> }
            </select>
            @if (!tenders().length) { <div class="help"><a class="link" routerLink="/tenders">Add a tender first →</a></div> }
            <div class="help">Results are also saved in the tender's history.</div>
          </div>
        </div>
      } @else {
        <div class="grid">
          <div><label>Cost estimate (NPR)</label>
            <input type="number" min="0" name="v" [(ngModel)]="q.estimateAmount" placeholder="e.g. 400000000" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div></div>
          <div><label>Required turnover (NPR)</label>
            <input type="number" min="0" name="rt" [(ngModel)]="q.requiredTurnover" placeholder="From the IFB" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div></div>
          <div><label>Required similar contract (NPR)</label>
            <input type="number" min="0" name="rs" [(ngModel)]="q.requiredSimilarValue" placeholder="From the IFB" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div></div>
          <div><label>Required bid capacity (NPR)</label>
            <input type="number" min="0" name="rb" [(ngModel)]="q.requiredBidCapacity" placeholder="From the IFB" />
            <div class="help tax">Enter taxable amount only (excluding VAT)</div></div>
        </div>
      }

      <h3>Companies <span class="req">*</span></h3>
      <label class="pick all"><input type="checkbox" name="allCo" [checked]="allSelected()" (change)="toggleAll()" /> <strong>All companies</strong> ({{ companies().length }})</label>
      <div class="picks">
        @for (c of companies(); track c.id) {
          <label class="pick"><input type="checkbox" [checked]="selected().has(c.id)" (change)="toggle(c.id)" /> {{ c.name }}</label>
        } @empty { <span class="help"><a class="link" routerLink="/companies">Add a company first →</a></span> }
      </div>
      <div class="help">{{ selected().size }} selected</div>

      <div class="actions">
        <button class="btn gold" (click)="run()" [disabled]="busy()">{{ busy() ? 'Checking ' + done() + ' / ' + selected().size + '…' : '✅ Check qualification' }}</button>
        @if (mode() === 'tender' && tenderId) { <a class="btn light" [routerLink]="['/tenders', tenderId]">Open tender workspace (JV builder) →</a> }
        @if (results().length) { <button class="btn light" (click)="exportExcel()">⬇ Excel report</button> }
      </div>
    </div>

    @if (results().length) {
      <div class="panel">
        <h2>Results</h2>
        <div class="counts">
          <span class="tag green">{{ count('INDIVIDUAL_ELIGIBLE') }} eligible alone</span>
          <span class="tag gold">{{ count('JV_REQUIRED') }} need a JV</span>
          <span class="tag red">{{ count('NOT_ELIGIBLE') }} not eligible</span>
          @if (failedCount()) { <span class="tag red">{{ failedCount() }} could not be checked</span> }
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Result</th><th>Why</th><th class="num">Fails</th><th class="num">Warnings</th><th></th></tr></thead>
            <tbody>
              @for (r of results(); track r.companyId) {
                <tr [class.sel]="detail()?.companyId === r.companyId">
                  <td><strong>{{ r.companyName }}</strong></td>
                  @if (r.error) {
                    <td><span class="verdict bad">Error</span></td><td class="why" colspan="3">{{ r.error }}</td><td></td>
                  } @else {
                    <td><span class="verdict" [class]="tone(r.result)">{{ label(r.result) }}</span></td>
                    <td class="why">{{ r.summary }}</td>
                    <td class="num">{{ fails(r) }}</td>
                    <td class="num">{{ r.warnings.length }}</td>
                    <td><button class="btn light small" (click)="detail.set(r)">Details</button></td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }

    @if (detail(); as d) {
      <div class="panel">
        <div class="bar tight"><h2>Details — {{ d.companyName }}</h2><button class="btn light small" (click)="detail.set(null)">Close</button></div>
        <app-qual-result [result]="d" />
      </div>
    }
  `,
  styles: [UI_STYLES, `
    .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
    .tab { border: 1px solid #d1d5db; background: #fff; padding: 8px 14px; border-radius: 20px; cursor: pointer; font-weight: 600; color: #1e3a5f; }
    .tab.on { background: #0a1f3d; color: #fff; border-color: #0a1f3d; }
    .help.tax { color: #b8860b; }
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 22px 0 10px; }
    .picks { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px; margin: 8px 0 4px; }
    .pick { display: flex; gap: 8px; align-items: center; font-weight: 500; border: 1px solid #e1e3e6; border-radius: 8px; padding: 8px 10px; margin: 0; cursor: pointer; }
    .pick input { width: auto; }
    .pick.all { display: inline-flex; border-color: #d4a017; background: #fffbeb; }
    .actions .btn { text-decoration: none; }
    .counts { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .tag.red { background: #fee2e2; color: #b91c1c; }
    .verdict { display: inline-block; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 10px; white-space: nowrap; }
    .verdict.good { background: #dcfce7; color: #15803d; }
    .verdict.mid { background: #fef5e0; color: #8a6508; }
    .verdict.bad { background: #fee2e2; color: #b91c1c; }
    .why { color: #374151; font-size: 13px; min-width: 240px; }
    tr.sel td { background: #fffbeb; }
    .btn.small { padding: 6px 12px; }
    .bar.tight { margin-bottom: 8px; align-items: center; }
    .bar.tight h2 { margin: 0; }
  `],
})
export class QualificationPage {
  private data = inject(DataService);
  companies = signal<any[]>([]);
  tenders = signal<any[]>([]);
  mode = signal<'tender' | 'quick'>('tender');
  busy = signal(false);
  done = signal(0);
  error = signal('');
  selected = signal<Set<string>>(new Set());
  results = signal<any[]>([]);
  detail = signal<any>(null);
  tenderId = '';
  q: any = { estimateAmount: null, requiredTurnover: null, requiredSimilarValue: null, requiredBidCapacity: null };

  allSelected = computed(() => this.companies().length > 0 && this.selected().size === this.companies().length);
  failedCount = computed(() => this.results().filter((r) => r.error).length);

  constructor() {
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: (e) => this.error.set(errorText(e)) });
    this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l), error: () => {} });
  }

  toggle(id: string) {
    const s = new Set(this.selected());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selected.set(s);
  }
  toggleAll() {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.companies().map((c) => c.id)));
  }
  label(v: string) { return verdictText(v); }
  tone(v: string) { return 'verdict ' + (v === 'INDIVIDUAL_ELIGIBLE' ? 'good' : v === 'JV_REQUIRED' ? 'mid' : 'bad'); }
  fails(r: any) { return (r.checks ?? []).filter((c: any) => c.status === 'FAIL').length; }
  count(v: string) { return this.results().filter((r) => r.result === v).length; }

  async run() {
    this.error.set('');
    this.detail.set(null);
    const ids = this.companies().filter((c) => this.selected().has(c.id)).map((c) => c.id);
    if (!ids.length) { this.error.set('Please tick at least one company, or "All companies".'); return; }
    let requirements: any = null;
    if (this.mode() === 'tender') {
      if (!this.tenderId) { this.error.set('Please choose a tender.'); return; }
    } else {
      requirements = {};
      for (const [k, v] of Object.entries(this.q)) if (v !== null && v !== '' && Number(v) >= 0) requirements[k] = Number(v);
      if (!Object.keys(requirements).length) { this.error.set('Enter at least one number.'); return; }
    }
    this.busy.set(true);
    this.done.set(0);
    this.results.set([]);
    const out: any[] = [];
    for (const id of ids) {
      const name = this.companies().find((c) => c.id === id)?.name ?? id;
      try {
        const r = this.mode() === 'tender'
          ? (await firstValueFrom(this.data.evaluateCompany(this.tenderId, id))).evaluation
          : await firstValueFrom(this.data.quickCheck({ companyId: id, requirements }));
        out.push(r);
      } catch (e) {
        out.push({ companyId: id, companyName: name, error: errorText(e) });
      }
      this.done.set(out.length);
    }
    const order: Record<string, number> = { INDIVIDUAL_ELIGIBLE: 0, JV_REQUIRED: 1, NOT_ELIGIBLE: 2 };
    out.sort((a, b) => (order[a.result] ?? 3) - (order[b.result] ?? 3) || String(a.companyName).localeCompare(b.companyName));
    this.results.set(out);
    if (out.length === 1 && !out[0].error) this.detail.set(out[0]);
    this.busy.set(false);
  }

  async exportExcel() {
    const t = this.mode() === 'tender'
      ? this.tenders().find((x) => x.id === this.tenderId) ?? { ifbNumber: 'Tender' }
      : { ifbNumber: 'Quick check', projectTitle: 'Quick numbers', boqAmount: this.q.estimateAmount };
    const { downloadQualificationReport } = await loadReport();
    downloadQualificationReport(t, this.results().filter((r) => !r.error));
  }
}
