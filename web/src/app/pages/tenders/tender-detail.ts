import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { QualResult, verdictText } from '../../shared/qual-result';
import { showBoth } from '../../core/nepali-date';
import { STATUS_LABEL } from '../../core/bid-labels';

const loadReport = () => import('../../core/report');

interface JvRow { companyId: string; share: number | null; }

@Component({
  selector: 'app-tender-detail',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, QualResult],
  template: `
    <div class="bar no-print">
      <div>
        <a class="link" routerLink="/tenders">← All tenders</a>
      </div>
      @if (tender()) {
        <div class="tools">
          <a class="btn light" [routerLink]="['/tenders']" [queryParams]="{ edit: tender().id }">Edit requirements</a>
          <button class="btn light" (click)="exportExcel()" [disabled]="!reportResults().length">⬇ Excel report</button>
          <button class="btn light" (click)="print()" [disabled]="!reportResults().length">🖨 Print</button>
        </div>
      }
    </div>

    @if (loadError()) { <div class="msg error">{{ loadError() }}</div> }
    @if (!tender() && !loadError()) { <div class="msg info">Loading tender… (the first load can take up to a minute while the server wakes up)</div> }

    @if (tender(); as t) {
      <h1>{{ t.ifbNumber }}</h1>
      <p class="sub">{{ t.projectTitle }}@if (t.procuringEntity) { · {{ t.procuringEntity }} }</p>

      <div class="panel">
        <h2>Requirements</h2>
        <div class="facts">
          <div><span>Deadline</span><strong>{{ both(t.deadlineDate) }}</strong></div>
          <div><span>Cost estimate</span><strong>{{ t.boqAmount != null ? 'Rs ' + (num(t.boqAmount) | number: '1.0-0') : '—' }}</strong></div>
          <div><span>Contract period</span><strong>{{ t.contractPeriodMonths ? t.contractPeriodMonths + ' months' : '—' }}</strong></div>
          <div><span>Turnover</span><strong>{{ t.reqTurnover != null ? 'Rs ' + (num(t.reqTurnover) | number: '1.0-0') : calc('turnover') }}</strong></div>
          <div><span>Bid capacity</span><strong>{{ t.reqBidCapacity != null ? 'Rs ' + (num(t.reqBidCapacity) | number: '1.0-0') : calc('capacity') }}</strong></div>
          <div><span>Similar contract</span><strong>{{ t.reqSimilarValue != null ? 'Rs ' + (num(t.reqSimilarValue) | number: '1.0-0') : calc('similar') }}{{ t.reqSimilarCount > 1 ? ' × ' + t.reqSimilarCount : '' }}</strong></div>
          <div><span>Type</span><strong>{{ t.projectType || '—' }}{{ t.isComplexWork ? ' · complex' : '' }}</strong></div>
        </div>
        @if (t.keyActivityReqs?.length) {
          <div class="kas">Key activities (one fiscal year):
            @for (k of t.keyActivityReqs; track $index) { <span class="tag">{{ k.name }} — {{ k.quantity | number: '1.0-2' }} {{ k.unit }}</span> }
          </div>
        }
        @if (!hasRequirements()) {
          <div class="msg info" style="margin-top:12px">This tender has no cost estimate or requirements yet, so only the licence and running contracts can be checked. <a class="link" [routerLink]="['/tenders']" [queryParams]="{ edit: t.id }">Add requirements →</a></div>
        }
      </div>

      <!-- Bid information (Task 1) -->
      <div class="panel no-print">
        <div class="bar tight">
          <h2>Bid information</h2>
          <a class="btn light small" routerLink="/bids" [queryParams]="{ tender: t.id }">+ Create bid record</a>
        </div>
        @if (tenderBids().length) {
          <div class="table-wrap"><table>
            <thead><tr><th>Bidder</th><th>Decision</th><th>Status</th><th class="num">Bid (NPR)</th><th>Checklist</th><th></th></tr></thead>
            <tbody>
              @for (b of tenderBids(); track b.id) {
                <tr>
                  <td>{{ b.company?.name }} @if (b.bidderType === 'JV') { <span class="tag gold">JV</span> }</td>
                  <td>{{ b.decision === 'NO_BID' ? 'No bid' : b.decision === 'BID' ? 'Bid' : 'Undecided' }}</td>
                  <td><span class="tag">{{ statusLabel(b.status) }}</span></td>
                  <td class="num">{{ b.bidAmount != null ? (num(b.bidAmount) | number: '1.0-0') : '—' }}</td>
                  <td>{{ (b.checklist ?? []).filter(isDone).length }}/{{ (b.checklist ?? []).length }}</td>
                  <td><a class="link" routerLink="/bids" [queryParams]="{ bid: b.id }">Open →</a></td>
                </tr>
              }
            </tbody>
          </table></div>
        } @else {
          <p class="help">No bid record yet. Create one to track the bid / no-bid decision, bid security, document checklist and the result.</p>
        }
      </div>

      <!-- 1. Company-wide bid decision -->
      <div class="panel no-print-break">
        <div class="bar tight">
          <h2>1. Which of my companies qualify?</h2>
          <button class="btn gold no-print" (click)="checkAll()" [disabled]="busy() === 'all'">{{ busy() === 'all' ? 'Checking…' : '✅ Check all companies' }}</button>
        </div>
        @if (allError()) { <div class="msg error">{{ allError() }}</div> }
        @if (all(); as a) {
          <div class="counts">
            <span class="tag green">{{ a.counts.INDIVIDUAL_ELIGIBLE }} eligible alone</span>
            <span class="tag gold">{{ a.counts.JV_REQUIRED }} need a JV</span>
            <span class="tag red">{{ a.counts.NOT_ELIGIBLE }} not eligible</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Result</th><th>Why</th><th class="num">Fails</th><th class="num">Warnings</th><th class="no-print"></th></tr></thead>
              <tbody>
                @for (r of a.results; track r.companyId) {
                  <tr [class.sel]="selected()?.companyId === r.companyId && !selected()?.partners">
                    <td><strong>{{ r.companyName }}</strong></td>
                    <td><span class="verdict" [class]="tone(r.result)">{{ label(r.result) }}</span></td>
                    <td class="why">{{ r.summary }}</td>
                    <td class="num">{{ fails(r) }}</td>
                    <td class="num">{{ r.warnings.length }}</td>
                    <td class="no-print row-actions">
                      <button class="btn light small" (click)="selected.set(r)">Details</button>
                      @if (r.result === 'JV_REQUIRED') { <button class="btn light small" (click)="findPartners(r.companyId)">Find JV partner</button> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (busy() !== 'all') {
          <p class="help">Checks every company in your workspace against this tender and saves the results.</p>
        }
      </div>

      @if (selected(); as s) {
        <div class="panel">
          <div class="bar tight">
            <h2>Details — {{ s.companyName ?? jvName(s) }}</h2>
            <button class="btn light small no-print" (click)="selected.set(null)">Close</button>
          </div>
          <app-qual-result [result]="s" />
        </div>
      }

      <!-- 2. JV builder -->
      <div class="panel no-print">
        <h2>2. Check a Joint Venture</h2>
        @if (jvError()) { <div class="msg error">{{ jvError() }}</div> }
        <div class="table-wrap">
          <table class="jv">
            <thead><tr><th>Lead</th><th>Partner company</th><th class="num">Share %</th><th></th></tr></thead>
            <tbody>
              @for (row of jvRows; track $index; let i = $index) {
                <tr>
                  <td><input type="radio" name="lead" [checked]="leadIndex === i" (change)="leadIndex = i" /></td>
                  <td><select [name]="'jvc' + i" [(ngModel)]="row.companyId">
                    <option value="">— Select company —</option>
                    @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
                  </select></td>
                  <td><input type="number" min="1" max="99" [name]="'jvs' + i" [(ngModel)]="row.share" class="right" /></td>
                  <td>@if (jvRows.length > 2) { <button class="btn danger" (click)="removeJvRow(i)">🗑️</button> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="help">Shares must add up to 100% (now {{ shareTotal() }}%). PPMO default: up to 3 partners; each partner needs 25% of the turnover requirement and one partner 40%.</div>
        <div class="actions">
          @if (jvRows.length < 3) { <button class="btn light" (click)="jvRows.push({ companyId: '', share: null })">+ Add partner</button> }
          <button class="btn" (click)="checkJv()" [disabled]="busy() === 'jv'">{{ busy() === 'jv' ? 'Checking…' : '🤝 Check this JV' }}</button>
        </div>
      </div>

      @if (partners(); as p) {
        <div class="panel no-print">
          <div class="bar tight">
            <h2>Best JV partners for {{ p.companyName }}</h2>
            <button class="btn light small" (click)="partners.set(null)">Close</button>
          </div>
          <p class="help">{{ p.note }}</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Partner</th><th>Lead</th><th>Result</th><th class="num">Combined turnover</th><th>Why</th><th></th></tr></thead>
              <tbody>
                @for (s of p.suggestions; track s.partnerId) {
                  <tr>
                    <td><strong>{{ s.partnerName }}</strong></td>
                    <td>{{ s.lead }} (60%)</td>
                    <td><span class="verdict" [class]="tone(s.result)">{{ label(s.result) }}</span></td>
                    <td class="num">{{ s.combinedTurnover | number: '1.0-0' }}</td>
                    <td class="why">{{ s.summary }}</td>
                    <td><button class="btn light small" (click)="useSuggestion(p.companyId, s)">Use this JV</button></td>
                  </tr>
                } @empty { <tr><td colspan="6" class="empty">You need at least two companies in your workspace.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- 3. History -->
      <div class="panel">
        <div class="bar tight">
          <h2>3. Saved results (history)</h2>
          <button class="btn light small no-print" (click)="loadHistory()">↻ Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Result</th><th>Explanation</th><th>Rule set</th><th>Checked on</th><th class="no-print"></th></tr></thead>
            <tbody>
              @for (h of history(); track h.id) {
                <tr>
                  <td>{{ h.companyName }}</td>
                  <td><span class="verdict" [class]="tone(h.result)">{{ label(h.result) }}</span></td>
                  <td class="why">{{ h.explanation }}</td>
                  <td>{{ h.ruleSetId || '—' }}</td>
                  <td>{{ both(h.calculatedAt) }}</td>
                  <td class="no-print">@if (h.checks) { <button class="btn light small" (click)="showHistory(h)">Details</button> }</td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No saved results yet — click "Check all companies".</td></tr> }
            </tbody>
          </table>
        </div>
      </div>

      <p class="print-only foot">ProcureNepal · © Cuidado Technology Pvt. Ltd. · This report is a guide calculated from the data entered and the default PPMO rules. The bid document always takes priority. Not legal advice.</p>
    }
  `,
  styles: [UI_STYLES, `
    .tools { display: flex; gap: 8px; flex-wrap: wrap; }
    .tools .btn { text-decoration: none; }
    .bar.tight { margin-bottom: 8px; align-items: center; }
    .bar.tight h2 { margin: 0; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .facts div { background: #f8f9fa; border-radius: 8px; padding: 10px 12px; }
    .facts span { display: block; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; }
    .facts strong { font-size: 14px; color: #0a1f3d; }
    .kas { margin-top: 12px; font-size: 13px; color: #374151; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .counts { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .tag.red { background: #fee2e2; color: #b91c1c; }
    .verdict { display: inline-block; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 10px; white-space: nowrap; }
    .verdict.good { background: #dcfce7; color: #15803d; }
    .verdict.mid { background: #fef5e0; color: #8a6508; }
    .verdict.bad { background: #fee2e2; color: #b91c1c; }
    .why { color: #374151; font-size: 13px; min-width: 240px; }
    tr.sel td { background: #fffbeb; }
    .row-actions { white-space: nowrap; }
    .row-actions .btn { margin-left: 6px; }
    .btn.small { padding: 6px 12px; }
    table.jv td { padding: 6px; border-bottom: 0; }
    table.jv input[type=radio] { width: auto; }
    input.right { text-align: right; }
    .print-only { display: none; }
    .foot { font-size: 11px; color: #6b7280; }
    @media print {
      .no-print { display: none !important; }
      .print-only { display: block; }
      .panel { break-inside: avoid; border-color: #ccc; }
    }
  `],
})
export class TenderDetailPage {
  private data = inject(DataService);
  private route = inject(ActivatedRoute);

  id = this.route.snapshot.paramMap.get('id') ?? '';
  tender = signal<any>(null);
  companies = signal<any[]>([]);
  loadError = signal('');
  busy = signal<'' | 'all' | 'jv' | 'partners'>('');
  all = signal<any>(null);
  allError = signal('');
  selected = signal<any>(null);
  partners = signal<any>(null);
  jvError = signal('');
  history = signal<any[]>([]);
  jvResults = signal<any[]>([]);
  tenderBids = signal<any[]>([]);
  statusLabel(s: string) { return STATUS_LABEL[s] ?? s; }
  isDone = (c: any) => !!c.done;

  jvRows: JvRow[] = [{ companyId: '', share: 60 }, { companyId: '', share: 40 }];
  leadIndex = 0;

  reportResults = computed(() => [...(this.all()?.results ?? []), ...this.jvResults()]);

  constructor() {
    this.data.getTender(this.id).subscribe({
      next: (t) => this.tender.set(t),
      error: (err) => this.loadError.set(errorText(err)),
    });
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: () => {} });
    this.loadHistory();
    this.data.getBids({ tenderId: this.id }).subscribe({ next: (l) => this.tenderBids.set(l), error: () => {} });
  }

  num(v: any) { return v == null ? 0 : Number(v); }

  /** Same default formulas as the engine (criteria overrides respected) — shown as "≈ Rs …" */
  calc(kind: 'turnover' | 'capacity' | 'similar'): string {
    const t = this.tender();
    const V = Number(t?.boqAmount) || 0;
    if (!V) return 'not set';
    const c = t.criteria ?? {};
    const T = Math.max(12, Number(t.contractPeriodMonths) || 12);
    const v = kind === 'turnover' ? ((c.turnoverMultiplier ?? 1.5) * V * 12) / T
      : kind === 'capacity' ? ((c.bidCapacityPercent ?? 100) / 100) * V
      : ((c.similarContractPercent ?? 40) / 100) * V;
    return '≈ Rs ' + Math.round(v).toLocaleString('en-US') + ' (calculated)';
  }
  both(d: any) { return showBoth(d); }
  label(v: string) { return verdictText(v); }
  tone(v: string) {
    return 'verdict ' + (v === 'INDIVIDUAL_ELIGIBLE' || v === 'JV_ELIGIBLE' ? 'good' : v === 'JV_REQUIRED' ? 'mid' : 'bad');
  }
  fails(r: any) { return (r.checks ?? []).filter((c: any) => c.status === 'FAIL').length; }
  jvName(r: any) { return (r.partners ?? []).map((p: any) => `${p.companyName} ${p.share}%`).join(' + '); }
  shareTotal() { return this.jvRows.reduce((s, r) => s + (Number(r.share) || 0), 0); }
  hasRequirements() {
    const t = this.tender();
    return !!(t && (t.boqAmount != null || t.reqTurnover != null || t.reqSimilarValue != null || t.reqBidCapacity != null || t.keyActivityReqs?.length || t.reqActivity));
  }

  loadHistory() {
    this.data.getQualifications(this.id).subscribe({ next: (l) => this.history.set(l), error: () => {} });
  }

  showHistory(h: any) {
    this.selected.set({
      companyId: h.companyId, companyName: h.companyName, result: h.result, summary: h.explanation,
      checks: h.checks ?? [], warnings: h.warnings ?? [], ruleSet: { name: h.ruleSetId, effectiveFrom: '' },
      evaluatedAt: h.calculatedAt, disclaimer: 'Saved result — run the check again to use the latest data.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async checkAll() {
    this.busy.set('all');
    this.allError.set('');
    try {
      const res = await firstValueFrom(this.data.evaluateAll(this.id));
      this.all.set(res);
      if (res.results?.length === 0) this.allError.set('You have no companies yet — add one under Companies.');
      this.loadHistory();
    } catch (err) {
      this.allError.set(errorText(err));
    }
    this.busy.set('');
  }

  async findPartners(companyId: string) {
    this.busy.set('partners');
    try {
      this.partners.set(await firstValueFrom(this.data.jvPartners(this.id, companyId)));
    } catch (err) {
      this.allError.set(errorText(err));
    }
    this.busy.set('');
  }

  useSuggestion(baseId: string, s: any) {
    const baseIsLead = s.lead !== s.partnerName;
    this.jvRows = baseIsLead
      ? [{ companyId: baseId, share: 60 }, { companyId: s.partnerId, share: 40 }]
      : [{ companyId: s.partnerId, share: 60 }, { companyId: baseId, share: 40 }];
    this.leadIndex = 0;
    this.checkJv();
  }

  removeJvRow(i: number) {
    this.jvRows.splice(i, 1);
    if (this.leadIndex >= this.jvRows.length) this.leadIndex = 0;
  }

  async checkJv() {
    this.jvError.set('');
    const rows = this.jvRows.filter((r) => r.companyId);
    if (rows.length < 2) { this.jvError.set('Choose at least two companies.'); return; }
    if (new Set(rows.map((r) => r.companyId)).size !== rows.length) { this.jvError.set('The same company is chosen twice.'); return; }
    if (rows.some((r) => !(Number(r.share) >= 1 && Number(r.share) <= 99))) { this.jvError.set('Each share must be between 1 and 99%.'); return; }
    if (Math.abs(this.shareTotal() - 100) > 0.01) { this.jvError.set(`Shares add up to ${this.shareTotal()}% — they must total 100%.`); return; }
    const lead = this.jvRows[this.leadIndex];
    this.busy.set('jv');
    try {
      const res = await firstValueFrom(this.data.evaluateJv(this.id, rows.map((r) => ({
        companyId: r.companyId, share: Number(r.share), isLead: r === lead,
      }))));
      this.jvResults.update((l) => [...l, res]);
      this.selected.set(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      this.jvError.set(errorText(err));
    }
    this.busy.set('');
  }

  async exportExcel() {
    const { downloadQualificationReport } = await loadReport();
    downloadQualificationReport(this.tender(), this.reportResults());
  }

  print() { window.print(); }
}
