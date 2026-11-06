import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';

@Component({
  selector: 'app-bolpatra',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>📋 Bolpatra eGP System</h1>
    <p class="sub">Prepare for PPMO e-GP (bolpatra.gov.np) tenders: certificates, tenders, qualification and JV checks. ProcureNepal prepares the information — you submit on the e-GP portal yourself.</p>

    <section class="cards">
      <a class="card" routerLink="/certificates"><div class="label">📜 Certificates</div><div class="value">{{ certificates() ?? '…' }}</div><div class="hint">Experience certificates and key activities →</div></a>
      <a class="card" routerLink="/tenders"><div class="label">📋 Tenders</div><div class="value">{{ tenders() ?? '…' }}</div><div class="hint">Tenders and their requirements →</div></a>
      <a class="card" routerLink="/qualification"><div class="label">✅ Qualification</div><div class="value">✓</div><div class="hint">Check one, several or all companies →</div></a>
      <a class="card" [routerLink]="['/soon', 'bolpatra.bid-info']"><div class="label">🗂️ Bid Information</div><div class="value soonv">Soon</div><div class="hint">Bid documents, security, post-bid status</div></a>
    </section>

    <section class="panel io">
      <h2>Excel templates, imports and PDF reading</h2>
      <p class="help">Download a template, fill it in Excel, then use <strong>⬆ Import Excel</strong> on that page. Tender notices and certificates can be read from PDF inside the Add / Edit form (📄 Read from PDF).</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Template</th><th>Import / Export / PDF</th></tr></thead>
          <tbody>
            <tr><td>Companies</td><td><button class="btn light small" (click)="tpl('companies')">📄 Download</button></td><td><a class="link" routerLink="/companies">Companies page → Import / Export Excel</a></td></tr>
            <tr><td>Annual turnover (per company)</td><td><button class="btn light small" (click)="tpl('turnover')">📄 Download</button></td><td><a class="link" routerLink="/companies">Companies → Turnover → Import Excel</a></td></tr>
            <tr><td>Experience certificates + key activities</td><td><button class="btn light small" (click)="tpl('certificates')">📄 Download</button></td><td><a class="link" routerLink="/certificates">Certificates → Import / Export Excel · Add → Read from PDF</a></td></tr>
            <tr><td>Tenders + key activity requirements</td><td><button class="btn light small" (click)="tpl('tenders')">📄 Download</button></td><td><a class="link" routerLink="/tenders">Tenders → Import / Export Excel · Add → Read from PDF</a></td></tr>
            <tr><td>Qualification report</td><td>—</td><td><a class="link" routerLink="/tenders">Tenders → Check qualification → ⬇ Excel report / 🖨 Print</a></td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>How the data links together</h2>
      <ol class="flow">
        <li><strong>Companies</strong> (+ audited turnover) → used by every check and every module.</li>
        <li><strong>Certificates</strong> (amounts, dates, key activities, running contracts) → turnover estimate, similar contracts, key activities, bid capacity (FIN-5) and the five-contract limit.</li>
        <li><strong>Tenders</strong> (requirements) → <strong>Qualification</strong> for one, several or all companies, JV builder and partner finder; results are saved in the tender's history.</li>
        <li>Coming next: a won tender becomes a <strong>Project</strong>; its bid and performance guarantees go to <strong>Bank Guarantee Management</strong>; on completion, project progress becomes a new <strong>certificate</strong>.</li>
      </ol>
    </section>
  `,
  styles: [UI_STYLES, `
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 18px; text-decoration: none; color: inherit; display: block; }
    .card:hover { border-color: #d4a017; }
    .label { color: #4b5563; font-size: 14px; }
    .value { font-size: 28px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .value.soonv { font-size: 18px; color: #b8860b; }
    .hint { font-size: 12px; color: #9ca3af; }
    .btn.small { padding: 6px 12px; }
    .flow { margin: 0; padding-left: 20px; color: #374151; line-height: 1.7; font-size: 14px; }
  `],
})
export class BolpatraPage {
  private data = inject(DataService);
  certificates = signal<number | null>(null);
  tenders = signal<number | null>(null);

  constructor() {
    this.data.getCertificates().subscribe({ next: (l) => this.certificates.set(l.length), error: () => this.certificates.set(0) });
    this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l.length), error: () => this.tenders.set(0) });
  }

  async tpl(kind: 'companies' | 'turnover' | 'certificates' | 'tenders') {
    if (kind === 'certificates') return (await import('../../core/excel')).downloadTemplate();
    const s = await import('../../core/sheets');
    if (kind === 'companies') s.companiesTemplate();
    else if (kind === 'turnover') s.turnoverTemplate();
    else s.tendersTemplate();
  }
}
