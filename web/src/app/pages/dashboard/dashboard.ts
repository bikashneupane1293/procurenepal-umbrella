import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="gold">Procure</span>Nepal</div>
        <nav>
          <a class="item active">🏠 Dashboard</a>
          <a class="item soon">🏢 Company <small>Soon</small></a>
          <a class="item soon">📜 Certificates <small>Soon</small></a>
          <a class="item soon">📋 Tenders <small>Soon</small></a>
          <a class="item soon">✅ Qualification <small>Soon</small></a>
          <a class="item soon">📊 Reports <small>Soon</small></a>
        </nav>
      </aside>

      <main class="main">
        <header class="topbar">
          <h1>Dashboard</h1>
          <div class="who">
            <span class="email">{{ user?.email }}</span>
            <span class="role">{{ user?.role }}</span>
            <button class="logout" (click)="logout()">Logout</button>
          </div>
        </header>

        <section class="welcome">
          <h2>Namaste! 🙏</h2>
          <p>You are signed in to <strong>ProcureNepal</strong> — the Construction Industry Operating System.</p>
        </section>

        <section class="cards">
          <div class="card"><div class="label">Companies</div><div class="value">—</div><div class="hint">Coming in Phase 6.3</div></div>
          <div class="card"><div class="label">Certificates</div><div class="value">—</div><div class="hint">Coming in Phase 6.3</div></div>
          <div class="card"><div class="label">Active Tenders</div><div class="value">—</div><div class="hint">Coming in Phase 6.4</div></div>
          <div class="card"><div class="label">Qualification Checks</div><div class="value">—</div><div class="hint">Coming in Phase 6.4</div></div>
        </section>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #f8f9fa; color: #1f2937; }
    .shell { display: flex; min-height: 100vh; }
    .sidebar { width: 240px; background: #0a1f3d; color: #fff; padding: 24px 16px; flex-shrink: 0; }
    .brand { font-size: 22px; font-weight: 800; margin: 0 8px 32px; }
    .gold { color: #d4a017; }
    nav { display: flex; flex-direction: column; gap: 4px; }
    .item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 8px; color: #e8eef6; text-decoration: none; cursor: default; }
    .item.active { background: #1e3a5f; color: #fff; border-left: 3px solid #d4a017; }
    .item.soon { opacity: 0.55; }
    .item small { font-size: 10px; background: rgba(212,160,23,0.25); color: #f5b942; padding: 2px 6px; border-radius: 10px; }
    .main { flex: 1; padding: 24px 32px; min-width: 0; }
    .topbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
    .topbar h1 { margin: 0; font-size: 26px; color: #0a1f3d; }
    .who { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .email { color: #4b5563; }
    .role { background: #fef5e0; color: #b8860b; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 12px; }
    .logout { background: #0a1f3d; color: #fff; border: 0; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; }
    .logout:hover { background: #1e3a5f; }
    .welcome { background: #fff; border: 1px solid #e1e3e6; border-left: 4px solid #d4a017; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; }
    .welcome h2 { margin: 0 0 6px; color: #0a1f3d; }
    .welcome p { margin: 0; color: #4b5563; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 20px; }
    .label { color: #4b5563; font-size: 14px; }
    .value { font-size: 32px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .hint { font-size: 12px; color: #9ca3af; }
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
export class DashboardPage {
  private auth = inject(AuthService);
  user = this.auth.getUser();

  logout() {
    this.auth.logout();
  }
}
