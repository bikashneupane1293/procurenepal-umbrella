import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { DataService, errorText } from '../../core/data.service';
import { renderGoogleButton } from '../../core/google-signin';
import { nptToday } from '../../core/nepal-time';

const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

/**
 * Join your company's workspace with its Org ID (Task 12) — or create a free account.
 *  - Google + Org ID: if the company already added this email, you join at once; otherwise the
 *    Owner gets a request and you start in your own free workspace meanwhile.
 *  - Email + password + Org ID: always a request the Owner approves (the email isn't proven).
 *  - Google without an Org ID: a free account; any company can add you later.
 */
@Component({
  selector: 'app-join',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand"><span class="gold">Procure</span>Nepal</div>
        @if (done(); as d) {
          <h1>{{ d.title }}</h1>
          <p class="sub">{{ d.text }}</p>
          <button class="btn gold" type="button" (click)="go()">Continue</button>
        } @else {
          <h1>Join your company on ProcureNepal</h1>
          <p class="sub">Your office gives you an <strong>Org ID</strong> (like PN-7K3Q9M). No Org ID? Continue with Google to create a free account — a company can add you later.</p>

          <label>Org ID <span class="muted">(optional for a free account)</span></label>
          <input [(ngModel)]="orgCode" name="org" placeholder="PN-XXXXXX" autocomplete="off" class="code" />

          @if (googleReady()) {
            <div class="google" #gbtn></div>
            <p class="hint">Fastest: if your office already added your Google email, you're in straight away.</p>
          } @else if (configLoaded()) {
            <p class="hint">Google sign-in isn't switched on for this server yet — use email and password below.</p>
          }

          <div class="or"><span>or sign up with email</span></div>
          @if (error()) { <div class="msg error">{{ error() }}</div> }
          <form (ngSubmit)="signupWithPassword()">
            <label>Full name</label>
            <input [(ngModel)]="fullName" name="fullName" autocomplete="name" />
            <label>Email</label>
            <input type="email" [(ngModel)]="email" name="email" autocomplete="email" />
            <label>Password</label>
            <input type="password" [(ngModel)]="password" name="password" autocomplete="new-password" placeholder="At least 8 characters, a letter and a number" />
            <button class="btn gold" type="submit" [disabled]="busy()">{{ busy() ? 'Creating your account…' : 'Sign up and ask to join' }}</button>
            <p class="hint">With email and password, the company's Owner approves you first.</p>
          </form>
          <p class="foot">Already have an account? <a routerLink="/login">Sign in</a></p>
        }
        <footer class="copy">© {{ year }} Cuidado Technology Pvt. Ltd. · ProcureNepal</footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #0a1f3d; }
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border-radius: 16px; padding: 32px; max-width: 440px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,.25); }
    .brand { font-size: 22px; font-weight: 800; margin-bottom: 18px; }
    .gold { color: #d4a017; }
    h1 { font-size: 20px; margin: 0 0 6px; color: #0a1f3d; }
    .sub { color: #4b5563; margin: 0 0 18px; font-size: 14px; }
    label { display: block; font-weight: 600; font-size: 13px; color: #0a1f3d; margin: 12px 0 4px; }
    .muted { color: #9ca3af; font-weight: 400; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #e1e3e6; border-radius: 8px; font-size: 14px; box-sizing: border-box; }
    input.code { text-transform: uppercase; letter-spacing: .05em; font-weight: 700; }
    .google { margin: 16px 0 4px; min-height: 44px; display: flex; justify-content: center; }
    .hint { font-size: 12px; color: #6b7280; margin: 6px 0 0; }
    .or { text-align: center; margin: 20px 0 6px; border-top: 1px solid #e5e7eb; line-height: 0; }
    .or span { background: #fff; padding: 0 10px; font-size: 12px; color: #9ca3af; }
    .btn { width: 100%; margin-top: 18px; padding: 12px; border: 0; border-radius: 8px; font-weight: 700; cursor: pointer; }
    .btn.gold { background: #d4a017; color: #fff; }
    .btn:disabled { opacity: .6; cursor: default; }
    .msg.error { background: #fef2f2; color: #b91c1c; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin: 10px 0; }
    .foot { margin-top: 16px; font-size: 13px; text-align: center; color: #4b5563; }
    .foot a { color: #b8860b; font-weight: 600; }
    .copy { margin-top: 24px; text-align: center; font-size: 11px; color: #9ca3af; }
  `],
})
export class JoinPage {
  private data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  @ViewChild('gbtn') set gbtn(el: ElementRef<HTMLElement> | undefined) {
    if (el && this.clientId) renderGoogleButton(el.nativeElement, this.clientId, (c) => this.withGoogle(c), 'continue_with').catch(() => this.googleReady.set(false));
  }

  year = nptToday().slice(0, 4);
  orgCode = '';
  fullName = '';
  email = '';
  password = '';
  private clientId: string | null = null;
  googleReady = signal(false);
  configLoaded = signal(false);
  busy = signal(false);
  error = signal('');
  done = signal<{ title: string; text: string } | null>(null);

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    this.orgCode = (q.get('org') ?? '').toUpperCase();
    this.email = q.get('email') ?? '';
    this.data.authConfig()
      .then((c) => { this.clientId = c.googleClientId; this.googleReady.set(!!c.googleClientId); })
      .catch(() => { /* server asleep or offline — the email form still works */ })
      .finally(() => this.configLoaded.set(true));
  }

  private finish(res: any) {
    this.auth.saveSession(res.access_token, res.user);
    const j = res.join;
    if (j?.result === 'JOINED') this.done.set({ title: `You've joined ${j.organization}`, text: 'Your workspace is ready.' });
    else if (j?.result === 'REQUESTED') this.done.set({ title: `Request sent to ${j.organization}`, text: "Their Owner will approve you. Until then you're in your own free workspace — sign in any time; once approved you'll be in theirs." });
    else if (j?.result === 'ALREADY_MEMBER') this.done.set({ title: `You're already in ${j.organization}`, text: 'Welcome back.' });
    else if (j?.result === 'ERROR') this.done.set({ title: "You're signed in, but couldn't join", text: `${j.message} You can try the Org ID again from your Account page.` });
    else this.done.set({ title: res.created ? 'Your free account is ready' : 'Welcome back', text: res.created ? "Give your personal ID (on your Account page) or your email to a company, and they can add you as staff." : 'Signed in.' });
  }

  async withGoogle(credential: string) {
    this.error.set(''); this.busy.set(true);
    try {
      this.finish(await this.data.googleLogin(credential, this.orgCode.trim() || undefined));
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.busy.set(false);
  }

  async signupWithPassword() {
    this.error.set('');
    if (!this.orgCode.trim()) return this.error.set('Enter the Org ID your office gave you (or use Google for a free account).');
    if (this.fullName.trim().length < 2) return this.error.set('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) return this.error.set('Enter a valid email address.');
    if (!PASSWORD.test(this.password)) return this.error.set('Password must be at least 8 characters with a letter and a number.');
    this.busy.set(true);
    try {
      this.finish(await this.data.joinSignup({ orgCode: this.orgCode.trim(), fullName: this.fullName.trim(), email: this.email.trim(), password: this.password }));
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.busy.set(false);
  }

  go() {
    // full reload so the menu, role and modules are read fresh for the new workspace
    location.href = this.done()?.title.startsWith('Request sent') ? '/account' : '/dashboard';
  }
}
