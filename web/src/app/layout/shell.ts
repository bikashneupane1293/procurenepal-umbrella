import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="gold">Procure</span>Nepal</div>
        <nav>
          <a class="item" routerLink="/dashboard" routerLinkActive="active">🏠 Dashboard</a>
          <a class="item" routerLink="/companies" routerLinkActive="active">🏢 Companies</a>
          <a class="item" routerLink="/certificates" routerLinkActive="active">📜 Certificates</a>
          <a class="item soon">📋 Tenders <small>Soon</small></a>
          <a class="item soon">✅ Qualification <small>Soon</small></a>
          <a class="item soon">📊 Reports <small>Soon</small></a>
        </nav>
      </aside>

      <div class="main">
        <header class="topbar">
          <span class="email">{{ user?.email }}</span>
          <span class="role">{{ user?.role }}</span>
          <button class="logout" (click)="logout()">Logout</button>
        </header>
        <router-outlet />
        <footer class="copy">© {{ year }} Cuidado Technology Pvt. Ltd. · ProcureNepal · All rights reserved.</footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #f8f9fa; color: #1f2937; }
    .shell { display: flex; min-height: 100vh; }
    .sidebar { width: 240px; background: #0a1f3d; color: #fff; padding: 24px 16px; flex-shrink: 0; }
    .brand { font-size: 22px; font-weight: 800; margin: 0 8px 32px; }
    .gold { color: #d4a017; }
    nav { display: flex; flex-direction: column; gap: 4px; }
    .item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 8px; color: #e8eef6; text-decoration: none; cursor: pointer; border-left: 3px solid transparent; }
    .item:hover { background: rgba(255,255,255,0.06); }
    .item.active { background: #1e3a5f; color: #fff; border-left-color: #d4a017; }
    .item.soon { opacity: 0.55; cursor: default; }
    .item.soon:hover { background: none; }
    .item small { font-size: 10px; background: rgba(212,160,23,0.25); color: #f5b942; padding: 2px 6px; border-radius: 10px; }
    .main { flex: 1; padding: 20px 32px 32px; min-width: 0; }
    .topbar { display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .email { color: #4b5563; }
    .role { background: #fef5e0; color: #b8860b; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 12px; }
    .logout { background: #0a1f3d; color: #fff; border: 0; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; }
    .logout:hover { background: #1e3a5f; }
    .copy { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e1e3e6; font-size: 12px; color: #9ca3af; text-align: center; }
    @media (max-width: 768px) {
      .shell { flex-direction: column; }
      .sidebar { width: auto; padding: 16px; }
      .brand { margin-bottom: 12px; }
      nav { flex-direction: row; overflow-x: auto; }
      .item { white-space: nowrap; }
      .item small { display: none; }
      .main { padding: 16px; }
    }
  `],
})
export class ShellLayout {
  private auth = inject(AuthService);
  user = this.auth.getUser();
  year = new Date().getFullYear();

  logout() {
    this.auth.logout();
  }
}
