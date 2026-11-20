import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { MENU } from '../../core/modules';
import { DataService } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { nptToday } from '../../core/nepal-time';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Dashboard</h1>
    <p class="sub">Overview of your workspace</p>
    @if (blocked()) { <div class="msg error">That page belongs to a module that is not active for your account. Ask the workspace Owner (Companies → User Setup System).</div> }

    <section class="welcome">
      <h2>Namaste! 🙏</h2>
      <p>You are signed in to <strong>ProcureNepal</strong> — the Construction Industry Operating System.</p>
    </section>

    <section class="panel today">
      <div class="bar tight"><h2>📌 Needs attention</h2><span class="help">{{ todayLabel }}</span></div>
      @if (alerts() === null) { <p class="help">Checking deadlines and expiries…</p> }
      @else if (!alerts()!.length) { <p class="help">✅ Nothing due — no bid deadlines in the next 7 days, no guarantees, renewals or services due soon, no fuel entries to check.</p> }
      @else {
        <div class="alist">
          @for (a of alerts()!.slice(0, showAll() ? 200 : 8); track $index) {
            <a class="al" [class.bad]="a.tone === 'bad'" [routerLink]="a.link">
              <span class="dot"></span>
              <div class="tx"><strong>{{ a.title }}</strong><div class="dt">{{ a.detail }}</div></div>
              <div class="dd">{{ a.date }}</div>
            </a>
          }
        </div>
        <div class="tools">
          @if (alerts()!.length > 8) { <button class="btn light small" (click)="showAll.set(!showAll())">{{ showAll() ? 'Show fewer' : 'Show all ' + alerts()!.length }}</button> }
          <a class="btn light small wa" [href]="waLink()" target="_blank" rel="noopener">🟢 Share on WhatsApp</a>
        </div>
      }
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
      <a class="card" routerLink="/tenders">
        <div class="label">Tenders</div>
        <div class="value">{{ tenders() ?? '…' }}</div>
        <div class="hint">Open Tenders →</div>
      </a>
      <a class="card" routerLink="/qualification">
        <div class="label">Qualification Check</div>
        <div class="value">✅</div>
        <div class="hint">Check a company →</div>
      </a>
    </section>

    <section class="panel mods">
      <h2>ERP modules</h2>
      <p class="help">Excel templates, imports and PDF reading are under <a class="link" routerLink="/bolpatra">📋 Bolpatra eGP System → Overview & templates</a>.</p>
      <div class="mgrid">
        @for (m of modules(); track m.key) {
          <a class="mcard" [routerLink]="m.route">
            <div class="mt">{{ m.icon }} {{ m.label }}</div>
            <div class="bar2"><span [style.width.%]="100 * m.ready / m.total"></span></div>
            <div class="hint">{{ m.ready }} of {{ m.total }} screens ready</div>
          </a>
        }
      </div>
    </section>
  `,
  styles: [UI_STYLES, `
    .welcome { background: #fff; border: 1px solid #e1e3e6; border-left: 4px solid #d4a017; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; }
    .welcome h2 { margin: 0 0 6px; color: #0a1f3d; }
    .welcome p { margin: 0; color: #4b5563; }
    .today { margin-bottom: 24px; }
    .btn.wa { text-decoration: none; }
    .alist { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
    .al { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #f3e3b5; background: #fffbeb; border-radius: 10px; text-decoration: none; color: inherit; }
    .al.bad { border-color: #fecaca; background: #fef2f2; }
    .al:hover { border-color: #d4a017; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #f0b429; flex-shrink: 0; }
    .al.bad .dot { background: #dc2626; }
    .tx { flex: 1; min-width: 0; } .tx strong { color: #0a1f3d; }
    .dt { font-size: 13px; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dd { font-size: 12px; color: #6b7280; white-space: nowrap; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 20px; text-decoration: none; color: inherit; display: block; }
    a.card:hover { border-color: #d4a017; }
    .label { color: #4b5563; font-size: 14px; }
    .value { font-size: 32px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .hint { font-size: 12px; color: #9ca3af; }
    .mods { margin-top: 24px; }
    .mgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .mcard { border: 1px solid #e1e3e6; border-radius: 10px; padding: 14px; text-decoration: none; color: inherit; display: block; }
    .mcard:hover { border-color: #d4a017; }
    .mt { font-weight: 700; color: #0a1f3d; margin-bottom: 8px; }
    .bar2 { height: 6px; background: #eef0f2; border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
    .bar2 span { display: block; height: 100%; background: #d4a017; }
  `],
})
export class DashboardPage {
  private data = inject(DataService);
  companies = signal<number | null>(null);
  certificates = signal<number | null>(null);
  tenders = signal<number | null>(null);

  private access = inject(AccessService);
  blocked = signal(!!inject(ActivatedRoute).snapshot.queryParamMap.get('blocked'));
  modules = computed(() => {
    this.access.info();
    return MENU.filter((m) => this.access.can(m.key)).map((m) => {
      const first = m.route ?? m.items.find((i) => i.route)?.route ?? '/soon/' + m.items[0].id;
      return { key: m.key, label: m.label, icon: m.icon, route: first, ready: m.items.filter((i) => i.status === 'built').length, total: m.items.length };
    });
  });

  alerts = signal<any[] | null>(null);
  showAll = signal(false);
  /** WhatsApp click-to-chat with today's list — choose the person or group in WhatsApp */
  waLink() {
    const l = this.alerts() ?? [];
    const text = `ProcureNepal — ${nptToday()}: ${l.length} item(s) need attention\n` +
      l.slice(0, 25).map((a) => `${a.tone === 'bad' ? '🔴' : '🟠'} ${a.title} — ${a.detail} (${a.date})`).join('\n') +
      (l.length > 25 ? `\n…and ${l.length - 25} more` : '') + '\nhttps://app.procurenepal.com/dashboard';
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }
  todayLabel = 'Today, ' + nptToday() + ' (Nepal Time)';

  constructor() {
    this.data.alerts().then((l) => this.alerts.set(l)).catch(() => this.alerts.set([]));
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l.length), error: () => this.companies.set(0) });
    this.data.getCertificates().subscribe({ next: (l) => this.certificates.set(l.length), error: () => this.certificates.set(0) });
    this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l.length), error: () => this.tenders.set(0) });
  }
}
