import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Dashboard</h1>
    <p class="sub">Overview of your workspace</p>

    <section class="welcome">
      <h2>Namaste! 🙏</h2>
      <p>You are signed in to <strong>ProcureNepal</strong> — the Construction Industry Operating System.</p>
    </section>

    <section class="cards">
      <a class="card" routerLink="/companies">
        <div class="label">Companies</div>
        <div class="value">{{ companies() ?? '…' }}</div>
        <div class="hint">Open Companies →</div>
      </a>
      <a class="card" routerLink="/certificates">
        <div class="label">Certificates</div>
        <div class="value">{{ certificates() ?? '…' }}</div>
        <div class="hint">Open Certificates →</div>
      </a>
      <div class="card">
        <div class="label">Tenders</div>
        <div class="value">{{ tenders() ?? '…' }}</div>
        <div class="hint">Screen coming in Phase 6.4</div>
      </div>
      <div class="card">
        <div class="label">Qualification Checks</div>
        <div class="value">—</div>
        <div class="hint">Coming in Phase 6.4</div>
      </div>
    </section>
  `,
  styles: [UI_STYLES, `
    .welcome { background: #fff; border: 1px solid #e1e3e6; border-left: 4px solid #d4a017; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; }
    .welcome h2 { margin: 0 0 6px; color: #0a1f3d; }
    .welcome p { margin: 0; color: #4b5563; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 20px; text-decoration: none; color: inherit; display: block; }
    a.card:hover { border-color: #d4a017; }
    .label { color: #4b5563; font-size: 14px; }
    .value { font-size: 32px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .hint { font-size: 12px; color: #9ca3af; }
  `],
})
export class DashboardPage {
  private data = inject(DataService);
  companies = signal<number | null>(null);
  certificates = signal<number | null>(null);
  tenders = signal<number | null>(null);

  constructor() {
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l.length), error: () => this.companies.set(0) });
    this.data.getCertificates().subscribe({ next: (l) => this.certificates.set(l.length), error: () => this.certificates.set(0) });
    this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l.length), error: () => this.tenders.set(0) });
  }
}
