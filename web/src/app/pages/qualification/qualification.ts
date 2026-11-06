import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { QualResult } from '../../shared/qual-result';

@Component({
  selector: 'app-qualification',
  standalone: true,
  imports: [FormsModule, RouterLink, QualResult],
  template: `
    <h1>Qualification Check</h1>
    <p class="sub">Check one company against a saved tender, or try quick numbers before you add the tender.</p>

    <div class="panel">
      <div class="tabs">
        <button class="tab" [class.on]="mode() === 'tender'" (click)="mode.set('tender')">Against a saved tender</button>
        <button class="tab" [class.on]="mode() === 'quick'" (click)="mode.set('quick')">Quick numbers</button>
      </div>
      @if (error()) { <div class="msg error">{{ error() }}</div> }
      <div class="grid">
        <div><label>Company <span class="req">*</span></label>
          <select name="co" [(ngModel)]="companyId">
            <option value="">— Select company —</option>
            @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
          </select></div>
        @if (mode() === 'tender') {
          <div><label>Tender <span class="req">*</span></label>
            <select name="t" [(ngModel)]="tenderId">
              <option value="">— Select tender —</option>
              @for (t of tenders(); track t.id) { <option [value]="t.id">{{ t.ifbNumber }} — {{ t.projectTitle }}</option> }
            </select>
            @if (!tenders().length) { <div class="help"><a class="link" routerLink="/tenders">Add a tender first →</a></div> }
          </div>
        } @else {
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
        }
      </div>
      <div class="actions">
        <button class="btn gold" (click)="run()" [disabled]="busy()">{{ busy() ? 'Checking…' : '✅ Check qualification' }}</button>
        @if (mode() === 'tender' && tenderId) { <a class="btn light" [routerLink]="['/tenders', tenderId]">Open tender workspace →</a> }
      </div>
    </div>

    @if (result()) {
      <div class="panel"><app-qual-result [result]="result()" /></div>
    }
  `,
  styles: [UI_STYLES, `
    .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
    .tab { border: 1px solid #d1d5db; background: #fff; padding: 8px 14px; border-radius: 20px; cursor: pointer; font-weight: 600; color: #1e3a5f; }
    .tab.on { background: #0a1f3d; color: #fff; border-color: #0a1f3d; }
    .help.tax { color: #b8860b; }
    .actions .btn { text-decoration: none; }
  `],
})
export class QualificationPage {
  private data = inject(DataService);
  companies = signal<any[]>([]);
  tenders = signal<any[]>([]);
  mode = signal<'tender' | 'quick'>('tender');
  busy = signal(false);
  error = signal('');
  result = signal<any>(null);
  companyId = '';
  tenderId = '';
  q: any = { estimateAmount: null, requiredTurnover: null, requiredSimilarValue: null, requiredBidCapacity: null };

  constructor() {
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: (e) => this.error.set(errorText(e)) });
    this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l), error: () => {} });
  }

  async run() {
    this.error.set('');
    this.result.set(null);
    if (!this.companyId) { this.error.set('Please choose a company.'); return; }
    const body: any = { companyId: this.companyId };
    if (this.mode() === 'tender') {
      if (!this.tenderId) { this.error.set('Please choose a tender.'); return; }
      body.tenderId = this.tenderId;
    } else {
      const r: any = {};
      for (const [k, v] of Object.entries(this.q)) if (v !== null && v !== '' && Number(v) >= 0) r[k] = Number(v);
      if (!Object.keys(r).length) { this.error.set('Enter at least one number.'); return; }
      body.requirements = r;
    }
    this.busy.set(true);
    try {
      this.result.set(await firstValueFrom(this.data.quickCheck(body)));
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.busy.set(false);
  }
}
