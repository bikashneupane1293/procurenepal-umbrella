import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { adToBs, showBoth } from '../../core/nepali-date';
import { STATUS_LABEL } from '../../core/bid-labels';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [DecimalPipe, FormsModule, RouterLink],
  template: `
    <div class="bar no-print">
      <div>
        <h1>Bolpatra Reports</h1>
        <p class="sub">Bids, win rate, deadlines, expiring securities and licences — calculated from your own workspace only.</p>
      </div>
      <div class="tools">
        <label class="inline">Look ahead
          <select name="days" [ngModel]="days()" (ngModelChange)="days.set(+$event); load()">
            @for (d of [7, 15, 30, 60, 90]; track d) { <option [value]="d">{{ d }} days</option> }
          </select></label>
        <button class="btn light" (click)="exportExcel()" [disabled]="!r()">⬇ Export Excel</button>
        <button class="btn light" (click)="print()" [disabled]="!r()">🖨 Print</button>
      </div>
    </div>
    <h1 class="print-only">ProcureNepal — Bolpatra Report</h1>

    @if (error()) { <div class="msg error">{{ error() }} <a class="link" (click)="load()">Try again</a></div> }
    @if (!r() && !error()) { <div class="msg info">Calculating… (the first load can take up to a minute while the server wakes up)</div> }

    @if (r(); as r) {
      <section class="cards">
        <div class="card"><div class="label">Tenders</div><div class="value">{{ r.tenders.total }}</div><div class="hint">{{ r.tenders.byStatus['active'] ?? 0 }} active</div></div>
        <div class="card"><div class="label">Bids submitted</div><div class="value">{{ r.bids.submitted }}</div><div class="hint">Rs {{ r.bids.submittedValue | number: '1.0-0' }}</div></div>
        <div class="card"><div class="label">Won</div><div class="value good">{{ r.bids.won }}</div><div class="hint">Rs {{ r.bids.wonValue | number: '1.0-0' }}</div></div>
        <div class="card"><div class="label">Win rate</div><div class="value">{{ r.bids.winRate === null ? '—' : r.bids.winRate + '%' }}</div><div class="hint">won ÷ (won + lost) · {{ r.bids.lost }} lost</div></div>
        <div class="card"><div class="label">Certificates to check</div><div class="value" [class.warn]="r.documents.pendingCertificates > 0">{{ r.documents.pendingCertificates }}</div><div class="hint">of {{ r.documents.totalCertificates }} — document check pending</div></div>
      </section>

      <div class="cols">
        <section class="panel">
          <h2>Deadlines in the next {{ r.windowDays }} days</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Tender</th><th>Deadline</th><th class="num">Days</th><th>Decision</th></tr></thead>
            <tbody>
              @for (u of r.tenders.upcoming; track u.tenderId) {
                <tr>
                  <td><a class="link" [routerLink]="['/tenders', u.tenderId]">{{ u.ifbNumber }}</a><div class="help">{{ u.projectTitle }}</div></td>
                  <td>{{ both(u.deadlineDate) }}</td>
                  <td class="num"><span [class.warnt]="u.daysLeft <= 3">{{ u.daysLeft }}</span></td>
                  <td>@if (u.decision === 'NO RECORD') { <a class="link no-print" routerLink="/bids" [queryParams]="{ tender: u.tenderId }">Create bid record →</a><span class="print-only">No record</span> } @else { {{ u.decision }} }</td>
                </tr>
              } @empty { <tr><td colspan="4" class="empty">No deadlines in this period.</td></tr> }
            </tbody>
          </table></div>
          @if (r.tenders.noDecision.length) { <div class="msg info">{{ r.tenders.noDecision.length }} upcoming tender(s) have no bid / no-bid decision yet.</div> }
        </section>

        <section class="panel">
          <h2>Bids by status</h2>
          <div class="bars">
            @for (s of statusRows(); track s.key) {
              <div class="brow"><span class="bl">{{ s.label }}</span><span class="bt"><span [style.width.%]="s.pct"></span></span><span class="bn">{{ s.n }}</span></div>
            }
          </div>
          <div class="help">Decisions: {{ r.bids.byDecision.BID }} bid · {{ r.bids.byDecision.NO_BID }} no bid · {{ r.bids.byDecision.UNDECIDED }} undecided</div>
        </section>
      </div>

      <section class="panel">
        <h2>Expiring in the next {{ r.windowDays }} days</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>What</th><th>Tender / company</th><th>Expiry</th><th class="num">Days</th><th class="num">Amount (NPR)</th></tr></thead>
          <tbody>
            @for (e of expiries(); track $index) {
              <tr>
                <td>{{ e.kind }}</td>
                <td>{{ e.who }}</td>
                <td>{{ both(e.expiry) }}</td>
                <td class="num"><span [class.warnt]="e.daysLeft <= 7">{{ e.daysLeft < 0 ? 'expired' : e.daysLeft }}</span></td>
                <td class="num">{{ e.amount ? (e.amount | number: '1.0-0') : '' }}</td>
              </tr>
            } @empty { <tr><td colspan="5" class="empty">Nothing expires in this period.</td></tr> }
          </tbody>
        </table></div>
        @if (r.expiring.missingLicence.length) { <div class="msg info">Licence expiry not entered for: {{ r.expiring.missingLicence.join(', ') }} — add it on the Companies page.</div> }
      </section>

      <section class="panel">
        <h2>By company</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Company</th><th class="num">Bids</th><th class="num">Submitted</th><th class="num">Won</th><th class="num">Lost</th><th class="num">Win rate</th><th class="num">Won value (NPR)</th><th class="num">Checked tenders</th><th>Qualification results</th><th class="num">Certificates to check</th></tr></thead>
          <tbody>
            @for (c of r.perCompany; track c.companyId) {
              <tr>
                <td><strong>{{ c.company }}</strong></td>
                <td class="num">{{ c.bids }}</td><td class="num">{{ c.submitted }}</td><td class="num">{{ c.won }}</td><td class="num">{{ c.lost }}</td>
                <td class="num">{{ c.winRate === null ? '—' : c.winRate + '%' }}</td>
                <td class="num">{{ c.wonValue | number: '1.0-0' }}</td>
                <td class="num">{{ c.tendersChecked }}</td>
                <td><span class="tag green">{{ c.eligible }} eligible</span> <span class="tag gold">{{ c.jvRequired }} JV</span> <span class="tag red">{{ c.notEligible }} not</span></td>
                <td class="num">{{ c.pendingDocumentChecks }}</td>
              </tr>
            } @empty { <tr><td colspan="10" class="empty">No companies yet.</td></tr> }
          </tbody>
        </table></div>
      </section>

      <section class="panel">
        <h2>Last 12 months</h2>
        <div class="months">
          @for (m of r.months; track m.month) {
            <div class="mcol" [title]="m.month + ': ' + m.submitted + ' submitted, ' + m.won + ' won'">
              <div class="mbar"><span class="sub" [style.height.%]="pct(m.submitted)"></span><span class="won" [style.height.%]="pct(m.won)"></span></div>
              <div class="mlabel">{{ m.month.slice(2) }}</div>
            </div>
          }
        </div>
        <div class="help"><span class="key sub"></span> submitted <span class="key won"></span> won (by award / submission month, AD)</div>
      </section>

      <p class="help">Generated {{ bs(r.generatedAt) }} BS · Bid prices are never shared with other ProcureNepal customers.</p>
    }
  `,
  styles: [UI_STYLES, `
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; font-weight: 600; margin: 0; }
    label.inline select { width: auto; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 16px; }
    .label { color: #4b5563; font-size: 13px; }
    .value { font-size: 28px; font-weight: 800; color: #0a1f3d; margin: 4px 0; }
    .value.good { color: #15803d; }
    .value.warn { color: #b45309; }
    .hint { font-size: 12px; color: #9ca3af; }
    .cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
    .warnt { color: #b91c1c; font-weight: 700; }
    .tag.red { background: #fee2e2; color: #b91c1c; }
    .bars { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
    .brow { display: grid; grid-template-columns: 130px 1fr 32px; gap: 8px; align-items: center; font-size: 13px; }
    .bt { height: 10px; background: #eef0f2; border-radius: 5px; overflow: hidden; }
    .bt span { display: block; height: 100%; background: #d4a017; }
    .bn { text-align: right; font-weight: 700; }
    .months { display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; align-items: end; height: 140px; margin-bottom: 8px; }
    .mcol { display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
    .mbar { width: 100%; max-width: 34px; height: 110px; display: flex; gap: 2px; align-items: flex-end; }
    .mbar span { flex: 1; border-radius: 3px 3px 0 0; min-height: 1px; }
    .mbar .sub, .key.sub { background: #1e3a5f; }
    .mbar .won, .key.won { background: #d4a017; }
    .key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 10px; }
    .mlabel { font-size: 10px; color: #6b7280; margin-top: 4px; }
    .print-only { display: none; }
    @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
    @media print { .no-print { display: none !important; } .print-only { display: inline; } h1.print-only { display: block; } .panel { break-inside: avoid; } }
  `],
})
export class ReportsPage {
  private data = inject(DataService);
  days = signal(30);
  r = signal<any>(null);
  error = signal('');

  statusRows = computed(() => {
    const r = this.r();
    if (!r) return [];
    const max = Math.max(1, ...Object.values(r.bids.byStatus as Record<string, number>));
    return Object.entries(r.bids.byStatus as Record<string, number>).map(([key, n]) => ({ key, label: STATUS_LABEL[key] ?? key, n, pct: (100 * n) / max }));
  });
  expiries = computed(() => {
    const r = this.r();
    if (!r) return [];
    const e = r.expiring;
    return [
      ...e.bidSecurities.map((x: any) => ({ kind: 'Bid security', who: `${x.ifbNumber} — ${x.company}${x.bank ? ' · ' + x.bank : ''}`, expiry: x.expiry, daysLeft: x.daysLeft, amount: x.amount })),
      ...e.bidValidity.map((x: any) => ({ kind: 'Bid validity', who: `${x.ifbNumber} — ${x.company}`, expiry: x.expiry, daysLeft: x.daysLeft, amount: null })),
      ...e.performanceSecurities.map((x: any) => ({ kind: 'Performance security', who: `${x.ifbNumber} — ${x.company}`, expiry: x.expiry, daysLeft: x.daysLeft, amount: x.amount })),
      ...e.licences.map((x: any) => ({ kind: 'Contractor licence', who: `${x.company}${x.licenseClass ? ' (Class ' + x.licenseClass + ')' : ''}`, expiry: x.expiry, daysLeft: x.daysLeft, amount: null })),
    ].sort((a, b) => a.daysLeft - b.daysLeft);
  });
  private monthMax = computed(() => Math.max(1, ...(this.r()?.months ?? []).map((m: any) => m.submitted)));

  constructor() { this.load(); }

  load() {
    this.error.set('');
    this.data.getReport(this.days()).subscribe({
      next: (r) => this.r.set(r),
      error: (e) => this.error.set(errorText(e)),
    });
  }
  pct(n: number) { return (100 * n) / this.monthMax(); }
  both(d: any) { return showBoth(d ? String(d).slice(0, 10) : d); }
  bs(d: any) { return adToBs(String(d).slice(0, 10)); }
  print() { window.print(); }

  async exportExcel() {
    const XLSX = await import('xlsx');
    const r = this.r();
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: any[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'None' }]), name);
    add('Summary', [
      { Item: 'Tenders', Value: r.tenders.total }, { Item: 'Bids submitted', Value: r.bids.submitted },
      { Item: 'Submitted value (NPR, excl. VAT)', Value: r.bids.submittedValue }, { Item: 'Won', Value: r.bids.won },
      { Item: 'Won value (NPR, excl. VAT)', Value: r.bids.wonValue }, { Item: 'Lost', Value: r.bids.lost },
      { Item: 'Win rate %', Value: r.bids.winRate ?? '' }, { Item: 'Certificates with document check pending', Value: r.documents.pendingCertificates },
      { Item: 'Look-ahead (days)', Value: r.windowDays }, { Item: 'Generated', Value: r.generatedAt },
      ...Object.entries(r.bids.byStatus).map(([k, v]) => ({ Item: 'Bids — ' + (STATUS_LABEL[k] ?? k), Value: v })),
    ]);
    add('Deadlines', r.tenders.upcoming.map((u: any) => ({ 'IFB No': u.ifbNumber, Project: u.projectTitle, 'Deadline (AD)': String(u.deadlineDate).slice(0, 10), 'Deadline (BS)': this.bs(u.deadlineDate), 'Days left': u.daysLeft, Decision: u.decision })));
    add('Expiring', this.expiries().map((e) => ({ What: e.kind, Who: e.who, 'Expiry (AD)': String(e.expiry).slice(0, 10), 'Expiry (BS)': this.bs(e.expiry), 'Days left': e.daysLeft, 'Amount (NPR)': e.amount ?? '' })));
    add('By Company', r.perCompany.map((c: any) => ({ Company: c.company, Bids: c.bids, Submitted: c.submitted, Won: c.won, Lost: c.lost, 'Win rate %': c.winRate ?? '', 'Won value (NPR)': c.wonValue, 'Checked tenders': c.tendersChecked, Eligible: c.eligible, 'JV required': c.jvRequired, 'Not eligible': c.notEligible, 'Certificates to check': c.pendingDocumentChecks })));
    add('Months', r.months.map((m: any) => ({ Month: m.month, Submitted: m.submitted, Won: m.won })));
    XLSX.writeFile(wb, `ProcureNepal_Bolpatra_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
}
