import { Component, inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../api.service';
import { AuthService } from '../../core/auth.service';
import { API_URL } from '../../core/config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  email = '';
  password = '';
  loading = false;
  errorMsg = '';
  successMsg = '';
  /** The API sleeps on free hosting after ~15 min idle; we wake it as soon as this page opens. */
  server: 'checking' | 'waking' | 'ready' | 'offline' = 'checking';
  slowLogin = false;

  constructor() {
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.wake();
  }

  private wake() {
    const started = Date.now();
    const slow = setTimeout(() => { if (this.server === 'checking') { this.server = 'waking'; this.cdr.detectChanges(); } }, 2500);
    const ctrl = new AbortController();
    const giveUp = setTimeout(() => ctrl.abort(), 90000);
    fetch(`${API_URL}/`, { signal: ctrl.signal, cache: 'no-store' })
      .then(() => { this.server = 'ready'; })
      .catch(() => { this.server = Date.now() - started > 85000 ? 'offline' : 'ready'; })
      .finally(() => { clearTimeout(slow); clearTimeout(giveUp); this.cdr.detectChanges(); });
  }

  // Pressing Enter inside the Email or Password box signs you in
  @HostListener('keydown.enter', ['$event'])
  onEnterKey(event: Event) {
    if (event.target instanceof HTMLInputElement && !this.loading) {
      event.preventDefault();
      this.onSubmit();
    }
  }

  onSubmit() {
    if (this.loading) return;
    this.loading = true;
    this.errorMsg = '';
    this.successMsg = '';
    this.slowLogin = false;
    const slow = setTimeout(() => { if (this.loading) { this.slowLogin = true; this.cdr.detectChanges(); } }, 4000);
    this.cdr.detectChanges();

    this.api.login(this.email, this.password).subscribe({
      next: (res: any) => {
        clearTimeout(slow);
        this.auth.saveSession(res.access_token, res.user);
        this.loading = false;
        this.slowLogin = false;
        this.successMsg = `Welcome ${res.user.email}! Opening your dashboard...`;
        this.cdr.detectChanges();
        this.router.navigate(['/dashboard']);
      },
      error: (err: any) => {
        clearTimeout(slow);
        this.loading = false;
        this.slowLogin = false;
        this.errorMsg = err.error?.message || err.message || 'Invalid credentials';
        this.cdr.detectChanges();
      },
    });
  }
}
