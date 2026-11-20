import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { AccessService } from '../core/access.service';
import { I18nService } from '../core/i18n.service';
import { MENU, MenuModule, moduleOfRoute } from '../core/modules';
import { DataService } from '../core/data.service';
import { nptToday } from '../core/nepal-time';

const OPEN_KEY = 'pn.menu.open';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="gold">Procure</span>Nepal</div>
        <nav>
          <a class="item top" routerLink="/dashboard" routerLinkActive="active">🏠 {{ i18n.t('dashboard') }}</a>
          @if (user?.role === 'SUPER_ADMIN') {
            <a class="item top" routerLink="/admin" routerLinkActive="active">🛡️ Admin Panel</a>
          }
          @for (m of visible(); track m.key) {
            <div class="group" [class.open]="isOpen(m.key)">
              <button class="ghead" type="button" (click)="toggle(m.key)" [attr.aria-expanded]="isOpen(m.key)">
                <span>{{ m.icon }} {{ i18n.modLabel(m.key, m.label) }}</span>
                <span class="chev">{{ isOpen(m.key) ? '▾' : '▸' }}</span>
              </button>
              @if (isOpen(m.key)) {
                <div class="gitems">
                  @if (m.route) {
                    <a class="item sub" [routerLink]="m.route" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Overview & templates</a>
                  }
                  @for (i of m.items; track i.id) {
                    @if (!access.canItem(i.id)) {
                      <!-- switched off for this workspace -->
                    } @else if (i.status === 'built') {
                      <a class="item sub" [routerLink]="i.route" routerLinkActive="active">{{ i.label }}</a>
                    } @else {
                      <a class="item sub soon" [routerLink]="['/soon', i.id]" routerLinkActive="active">{{ i.label }} <small>Soon</small></a>
                    }
                  }
                </div>
              }
            </div>
          }
        </nav>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="lang" type="button" (click)="i18n.toggle()" [attr.aria-label]="'Switch language'">{{ i18n.lang() === 'en' ? 'ने ' : 'EN ' }}</button>
          <a class="acct" routerLink="/account" routerLinkActive="on">👤 Account @if (inviteCount()) { <span class="badge" title="Invitations waiting">{{ inviteCount() }}</span> }</a>
          <span class="email">{{ user?.email }}</span>
          <span class="role">{{ user?.role }}</span>
          <button class="logout" (click)="logout()">{{ i18n.t('logout') }}</button>
        </header>
        @if (planBanner(); as b) {
          <div class="planbar" [class.bad]="b.bad">{{ b.text }}</div>
        }
        <router-outlet />
        <footer class="copy">© {{ year }} Cuidado Technology Pvt. Ltd. · ProcureNepal · All rights reserved.</footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #f8f9fa; color: #1f2937; }
    .shell { display: flex; min-height: 100vh; }
    .sidebar { width: 270px; background: #0a1f3d; color: #fff; padding: 24px 14px; flex-shrink: 0; overflow-y: auto; max-height: 100vh; position: sticky; top: 0; }
    .brand { font-size: 22px; font-weight: 800; margin: 0 8px 24px; }
    .gold { color: #d4a017; }
    nav { display: flex; flex-direction: column; gap: 2px; }
    .item { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px; color: #e8eef6; text-decoration: none; cursor: pointer; border-left: 3px solid transparent; font-size: 14px; }
    .item:hover { background: rgba(255,255,255,0.06); }
    .item.active { background: #1e3a5f; color: #fff; border-left-color: #d4a017; }
    .item.top { font-size: 15px; padding: 10px 12px; margin-bottom: 6px; }
    .item.sub { padding: 7px 10px 7px 30px; font-size: 13px; }
    .item.soon { color: #9fb0c8; }
    .item small { font-size: 9px; background: rgba(212,160,23,0.22); color: #f5b942; padding: 2px 6px; border-radius: 10px; flex-shrink: 0; }
    .group { margin-top: 2px; }
    .ghead { width: 100%; display: flex; justify-content: space-between; align-items: center; background: none; border: 0; color: #fff; font: inherit; font-weight: 700; font-size: 14px; padding: 9px 12px; border-radius: 8px; cursor: pointer; text-align: left; }
    .ghead:hover { background: rgba(255,255,255,0.06); }
    .group.open .ghead { color: #f5b942; }
    .chev { font-size: 11px; opacity: .7; }
    .main { flex: 1; padding: 20px 32px 32px; min-width: 0; }
    .topbar { display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .email { color: #4b5563; }
    .role { background: #fef5e0; color: #b8860b; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 12px; }
    .acct { color: #0a1f3d; text-decoration: none; font-weight: 600; font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; display: inline-flex; gap: 6px; align-items: center; }
    .acct.on, .acct:hover { border-color: #d4a017; }
    .badge { background: #dc2626; color: #fff; border-radius: 10px; font-size: 11px; padding: 1px 7px; font-weight: 700; }
    .planbar { background: #fff7e6; border: 1px solid #e6c870; color: #7a5200; padding: 10px 14px; border-radius: 10px; margin-bottom: 14px; font-size: 14px; }
    .planbar.bad { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
    .logout { background: #0a1f3d; color: #fff; border: 0; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; }
    .logout:hover { background: #1e3a5f; }
    .lang { background: #fff; color: #0a1f3d; border: 1px solid #d1d5db; padding: 6px 12px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; }
    .lang:hover { background: #f3f4f6; }
    .copy { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e1e3e6; font-size: 12px; color: #9ca3af; text-align: center; }
    @media (max-width: 768px) {
      .shell { flex-direction: column; }
      .sidebar { width: auto; padding: 14px; max-height: none; position: static; }
      .brand { margin-bottom: 10px; }
      .main { padding: 16px; }
    }
  `],
})
export class ShellLayout {
  private auth = inject(AuthService);
  access = inject(AccessService); // used directly in the template (canItem)
  private router = inject(Router);
  private el = inject(ElementRef);
  i18n = inject(I18nService); // used directly in the template (toggle, t, modLabel)
  user = this.auth.getUser();
  year = nptToday().slice(0, 4); // Nepal Time
  private data = inject(DataService);
  inviteCount = signal(0);
  /** Task 11: plan expiry warnings (Nepal dates). Owners see the run-up; everyone sees "expired". */
  planBanner = computed<{ text: string; bad: boolean } | null>(() => {
    const st = this.access.info()?.planState;
    const owner = ['OWNER', 'SUPER_ADMIN'].includes(this.access.info()?.role ?? '');
    if (!st) return null;
    if (st.state === 'EXPIRED') {
      return { bad: true, text: `Your ${st.plan} plan has ended${st.expiresOn ? ` (expired ${st.expiresOn})` : ''} — only the FREE plan's modules are open.${owner ? ' Contact ProcureNepal to renew; everything comes back as it was.' : ' Ask your Owner to renew.'}` };
    }
    if (!owner) return null;
    if (st.state === 'GRACE') {
      return { bad: true, text: `Your ${st.plan} plan expired on ${st.expiresOn}. You're in the ${st.daysLeft === 0 ? 'last day of the' : ''} grace period — on ${st.graceEndsOn} the workspace drops to the FREE plan's modules unless it's renewed.` };
    }
    if (st.state === 'EXPIRING_SOON') {
      return { bad: false, text: st.daysLeft === 0 ? `Your ${st.plan} plan expires today (${st.expiresOn}, Nepal time). Contact ProcureNepal to renew.` : `Your ${st.plan} plan expires in ${st.daysLeft} day(s), on ${st.expiresOn}. Contact ProcureNepal to renew.` };
    }
    return null;
  });

  private open = signal<Set<string>>(this.readOpen());
  visible = computed<MenuModule[]>(() => {
    this.access.info(); // re-run when access info arrives
    return MENU.filter((m) => this.access.can(m.key));
  });

  constructor() {
    this.access.load(true);
    this.data.staffMe().then((m) => this.inviteCount.set(m.invites?.length ?? 0)).catch(() => { /* older API */ });
    this.openFor(this.router.url);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e: any) => this.openFor(e.urlAfterRedirects));
  }

  isOpen(key: string) { return this.open().has(key); }
  toggle(key: string) {
    const s = new Set(this.open());
    s.has(key) ? s.delete(key) : s.add(key);
    this.open.set(s);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* storage blocked */ }
  }
  /** Navigation always opens exactly the section you're in (and closes the rest), so you can
   *  always see where you are — then scrolls that section into view inside the sidebar. */
  private openFor(url: string) {
    const soonId = url.startsWith('/soon/') ? url.split('/')[2] : null;
    const key = soonId ? MENU.find((m) => m.items.some((i) => i.id === soonId))?.key : moduleOfRoute(url.split('?')[0]);
    if (key) {
      this.open.set(new Set([key]));
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([key])); } catch { /* storage blocked */ }
    }
    setTimeout(() => this.scrollActiveIntoView(), 60);
  }
  private scrollActiveIntoView() {
    const root: HTMLElement = this.el.nativeElement;
    const target: HTMLElement | null =
      root.querySelector('.sidebar .item.active') ?? root.querySelector('.sidebar .group.open .ghead');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  private readOpen(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '["companies","bolpatra"]')); } catch { return new Set(['companies', 'bolpatra']); }
  }

  logout() {
    this.access.clear();
    this.auth.logout();
  }
}
