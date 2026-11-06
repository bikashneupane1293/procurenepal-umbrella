import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * Shows a qualification result (single company or JV) from the engine:
 * verdict badge, summary, every check with its reason, warnings and disclaimer.
 */
@Component({
  selector: 'app-qual-result',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (r(); as r) {
      <div class="verdict" [class]="tone()">
        <div class="badge">{{ verdictLabel() }}</div>
        <div class="summary">{{ r.summary }}</div>
        @if (r.suggestedJvRole) {
          <div class="role">Suggested JV role: <strong>{{ r.suggestedJvRole === 'LEAD' ? 'Lead partner' : 'Partner' }}</strong></div>
        }
      </div>

      @if (r.partners?.length) {
        <div class="table-wrap">
          <table class="partners">
            <thead><tr><th>Partner</th><th class="num">Share</th><th class="num">Avg. turnover</th><th class="num">Bid capacity</th><th class="num">Running contracts</th></tr></thead>
            <tbody>
              @for (p of r.partners; track p.companyId) {
                <tr>
                  <td>{{ p.companyName }} @if (p.isLead) { <span class="tag gold">Lead</span> }</td>
                  <td class="num">{{ p.share }}%</td>
                  <td class="num">{{ p.averageAnnualTurnover | number: '1.0-0' }}</td>
                  <td class="num">{{ p.bidCapacity | number: '1.0-0' }}</td>
                  <td class="num">{{ p.runningOpenBidContracts }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <div class="table-wrap">
        <table class="checks">
          <thead><tr><th style="width:110px">Result</th><th>Requirement</th><th class="num">Required</th><th class="num">You have</th><th>Why</th></tr></thead>
          <tbody>
            @for (c of r.checks; track $index) {
              <tr>
                <td><span class="st" [class]="c.status">{{ statusLabel(c.status) }}</span></td>
                <td>
                  <strong>{{ c.title }}</strong>
                  @if (c.usesUnverified) { <div class="flag">⚠ uses a certificate whose document check is pending</div> }
                </td>
                <td class="num">{{ fmt(c.required, c.unit) }}</td>
                <td class="num">{{ fmt(c.actual, c.unit) }}</td>
                <td class="why">{{ c.reason }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (r.warnings?.length) {
        <div class="msg info warn-list">
          <strong>Missing information and warnings</strong>
          <ul>@for (w of r.warnings; track $index) { <li>{{ w }}</li> }</ul>
        </div>
      }

      <div class="foot">
        Rule set: <strong>{{ r.ruleSet?.name }}</strong> (from {{ r.ruleSet?.effectiveFrom }})
        @if (r.certificatesUsed !== undefined) {
          · {{ r.certificatesUsed }} certificate(s) used, {{ r.certificatesPendingDocumentCheck }} pending document check
        }
        · {{ r.evaluatedAt?.slice(0, 16)?.replace('T', ' ') }} UTC
        <div class="disc">{{ r.disclaimer }}</div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .verdict { border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; border: 1px solid; }
    .verdict.good { background: #f0fdf4; border-color: #bbf7d0; color: #14532d; }
    .verdict.mid { background: #fef5e0; border-color: #f5d98a; color: #6b4e06; }
    .verdict.bad { background: #fef2f2; border-color: #fecaca; color: #7f1d1d; }
    .badge { font-weight: 800; font-size: 16px; letter-spacing: .02em; }
    .summary { margin-top: 4px; font-size: 14px; }
    .role { margin-top: 6px; font-size: 13px; }
    .table-wrap { overflow-x: auto; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 10px; background: #e8eef6; color: #0a1f3d; white-space: nowrap; }
    td { padding: 8px 10px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .why { color: #374151; min-width: 260px; }
    .st { display: inline-block; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 10px; }
    .st.PASS { background: #dcfce7; color: #15803d; }
    .st.FAIL { background: #fee2e2; color: #b91c1c; }
    .st.WARN { background: #fef5e0; color: #8a6508; }
    .st.NOT_REQUIRED { background: #f3f4f6; color: #6b7280; }
    .flag { color: #b45309; font-size: 11px; margin-top: 2px; }
    .tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
    .tag.gold { background: #fef5e0; color: #8a6508; }
    .msg.info { background: #fef5e0; color: #6b4e06; border: 1px solid #f5d98a; padding: 10px 14px; border-radius: 8px; font-size: 13px; }
    .warn-list ul { margin: 6px 0 0 18px; padding: 0; }
    .foot { font-size: 11px; color: #6b7280; margin-top: 10px; }
    .disc { margin-top: 4px; font-style: italic; }
  `],
})
export class QualResult {
  result = input<any>(null);
  r = computed(() => this.result());

  tone = computed(() => {
    const v = this.result()?.result;
    return v === 'INDIVIDUAL_ELIGIBLE' || v === 'JV_ELIGIBLE' ? 'verdict good' : v === 'JV_REQUIRED' ? 'verdict mid' : 'verdict bad';
  });

  verdictLabel = computed(() => verdictText(this.result()?.result));

  statusLabel(s: string) {
    return s === 'PASS' ? '✔ Pass' : s === 'FAIL' ? '✖ Fail' : s === 'WARN' ? '⚠ Check' : '— Not set';
  }

  fmt(v: number | null | undefined, unit: string): string {
    if (v === null || v === undefined) return '—';
    if (unit === 'date') return '';
    const n = Math.round(Number(v) * 100) / 100;
    const s = n.toLocaleString('en-IN', { maximumFractionDigits: unit === 'NPR' ? 0 : 2 });
    return unit === 'NPR' ? 'Rs ' + s : `${s} ${unit}`;
  }
}

export function verdictText(v: string | undefined): string {
  switch (v) {
    case 'INDIVIDUAL_ELIGIBLE': return '✔ ELIGIBLE (single bidder)';
    case 'JV_REQUIRED': return '🤝 JV REQUIRED';
    case 'NOT_ELIGIBLE': return '✖ NOT ELIGIBLE';
    case 'JV_ELIGIBLE': return '✔ JV ELIGIBLE';
    case 'JV_NOT_ELIGIBLE': return '✖ JV NOT ELIGIBLE';
    default: return v ?? '';
  }
}
