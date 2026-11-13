import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../../core/config';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../core/data.service';

const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

/** A new user opens this from the link the Owner sent them, and sets their own password. */
@Component({
  selector: 'app-activate',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand"><span class="gold">Procure</span>Nepal</div>
        @if (checking()) {
          <p>Checking your activation link…</p>
        } @else if (linkError()) {
          <div class="msg error">{{ linkError() }}</div>
          <p><a routerLink="/login">← Back to sign in</a></p>
        } @else {
          <h1>Welcome, {{ fullName() }}</h1>
          <p class="sub">Set a password for <strong>{{ email() }}</strong> to finish activating your account.</p>
          @if (formError()) { <div class="msg error">{{ formError() }}</div> }
          <form (ngSubmit)="activate()">
            <label>New password</label>
            <input type="password" [(ngModel)]="password" name="password" autocomplete="new-password" placeholder="At least 8 characters, a letter and a number" />
            <label>Confirm password</label>
            <input type="password" [(ngModel)]="confirm" name="confirm" autocomplete="new-password" />
            <button class="btn gold" type="submit" [disabled]="busy()">{{ busy() ? 'Activating…' : 'Set password and sign in' }}</button>
          </form>
        }
        <footer class="copy">© {{ year }} Cuidado Technology Pvt. Ltd. · ProcureNepal</footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #0a1f3d; }
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border-radius: 16px; padding: 32px; max-width: 420px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,.25); }
    .brand { font-size: 22px; font-weight: 800; margin-bottom: 18px; }
    .gold { color: #d4a017; }
    h1 { font-size: 20px; margin: 0 0 6px; color: #0a1f3d; }
    .sub { color: #4b5563; margin: 0 0 18px; font-size: 14px; }
    label { display: block; font-weight: 600; font-size: 13px; color: #0a1f3d; margin: 12px 0 4px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #e1e3e6; border-radius: 8px; font-size: 14px; box-sizing: border-box; }
    .btn { width: 100%; margin-top: 18px; padding: 12px; border: 0; border-radius: 8px; font-weight: 700; cursor: pointer; }
    .btn.gold { background: #d4a017; color: #fff; }
    .btn:disabled { opacity: .6; cursor: default; }
    .msg.error { background: #fef2f2; color: #b91c1c; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 10px; }
    .copy { margin-top: 24px; text-align: center; font-size: 11px; color: #9ca3af; }
  `],
})
export class ActivatePage {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  token = this.route.snapshot.queryParamMap.get('token') ?? '';
  checking = signal(true);
  linkError = signal('');
  fullName = signal('');
  email = signal('');
  password = '';
  confirm = '';
  busy = signal(false);
  formError = signal('');
  year = new Date().getFullYear();

  constructor() {
    if (!this.token) { this.linkError.set('This activation link is missing its token.'); this.checking.set(false); return; }
    this.check();
  }

  async check() {
    try {
      const r: any = await firstValueFrom(this.http.get(`${API_URL}/auth/activate/${this.token}`));
      this.fullName.set(r.fullName);
      this.email.set(r.email);
    } catch (e) {
      this.linkError.set(errorText(e));
    }
    this.checking.set(false);
  }

  async activate() {
    if (!PASSWORD.test(this.password)) { this.formError.set('Password must be at least 8 characters with a letter and a number.'); return; }
    if (this.password !== this.confirm) { this.formError.set('Passwords do not match.'); return; }
    this.busy.set(true);
    this.formError.set('');
    try {
      const r: any = await firstValueFrom(this.http.post(`${API_URL}/auth/activate`, { token: this.token, password: this.password }));
      this.auth.saveSession(r.access_token, r.user);
      this.router.navigate(['/dashboard']);
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.busy.set(false);
  }
}
