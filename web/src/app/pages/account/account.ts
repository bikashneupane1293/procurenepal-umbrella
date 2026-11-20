import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';

/** The signed-in person's own page (Task 12): personal ID, organization, invitations, join by Org ID. */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <h1>👤 My account</h1>
    @if (error()) { <div class="msg error">{{ error() }}</div> }
    @if (msg()) { <div class="msg info">{{ msg() }}</div> }
    @if (me(); as m) {
      <div class="panel">
        <div class="cards">
          <div>
            <label>Your personal ID</label>
            <div class="id">{{ m.userCode }} <button class="btn light small" (click)="copy(m.userCode)">{{ copied() ? '✅ Copied' : '📋 Copy' }}</button></div>
            <p class="help">Give this (or your email) to a company that wants to add you as staff.</p>
          </div>
          <div>
            <label>You are in</label>
            <div class="org">{{ m.organization }} @if (m.personal) { <span class="tag">Free personal workspace</span> }</div>
            <p class="help">{{ m.email }} · {{ m.role }} @if (m.googleLinked) { · Google sign-in linked }</p>
          </div>
        </div>
      </div>

      @if (m.invites.length) {
        <div class="panel invite">
          <h2>📨 Invitations</h2>
          @for (i of m.invites; track i.id) {
            <div class="row">
              <div><strong>{{ i.organization }}</strong> wants to add you as <strong>{{ i.role }}</strong>
                <span class="muted">· {{ i.createdAt | date: 'yyyy-MM-dd' }}</span>
                @if (!m.personal) { <div class="muted">Accepting moves you out of {{ m.organization }}.</div> }
              </div>
              <div class="act">
                <button class="btn gold small" (click)="accept(i.id)" [disabled]="busy()">Accept</button>
                <button class="btn light small" (click)="decline(i.id)" [disabled]="busy()">Decline</button>
              </div>
            </div>
          }
        </div>
      }

      @if (m.requests.length) {
        <div class="panel">
          <h2>⏳ Waiting for approval</h2>
          @for (r of m.requests; track r.id) {
            <p>You asked to join <strong>{{ r.organization }}</strong> on {{ r.createdAt | date: 'yyyy-MM-dd' }} — their Owner hasn't decided yet.</p>
          }
        </div>
      }

      <div class="panel">
        <h2>Join a company with its Org ID</h2>
        <p class="help">If the company already added your email or personal ID you join straight away; otherwise their Owner gets a request.</p>
        <div class="row">
          <input [(ngModel)]="orgCode" placeholder="PN-XXXXXX" class="code" />
          <button class="btn gold" (click)="join()" [disabled]="busy() || !orgCode.trim()">Join</button>
        </div>
      </div>
    } @else if (!error()) {
      <p class="help">Loading…</p>
    }
  `,
  styles: [UI_STYLES, `
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
    label { font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
    .id { font-size: 26px; font-weight: 800; color: #0a1f3d; letter-spacing: .04em; display: flex; gap: 12px; align-items: center; margin-top: 4px; }
    .org { font-size: 18px; font-weight: 700; color: #0a1f3d; margin-top: 6px; }
    .tag { font-size: 11px; background: #fef3c7; color: #a16a00; padding: 3px 8px; border-radius: 10px; margin-left: 6px; font-weight: 700; }
    .invite { border-left: 4px solid #d4a017; }
    .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; padding: 8px 0; }
    .act { display: flex; gap: 8px; }
    .muted { color: #9ca3af; font-size: 13px; }
    input.code { max-width: 220px; text-transform: uppercase; font-weight: 700; letter-spacing: .05em; }
    .btn.small { padding: 6px 12px; font-size: 13px; }
  `],
})
export class AccountPage {
  private data = inject(DataService);
  private auth = inject(AuthService);
  me = signal<any | null>(null);
  error = signal('');
  msg = signal('');
  busy = signal(false);
  copied = signal(false);
  orgCode = '';

  constructor() { this.load(); }

  async load() {
    try { this.me.set(await this.data.staffMe()); } catch (e) { this.error.set(errorText(e)); }
  }

  async copy(v: string) {
    try { await navigator.clipboard.writeText(v); this.copied.set(true); setTimeout(() => this.copied.set(false), 2500); } catch { /* clipboard blocked */ }
  }

  /** After moving to another organization: update the saved session and reload everything. */
  private moved(user: any) {
    this.auth.saveSession(this.auth.getToken()!, user);
    location.href = '/dashboard';
  }

  async accept(id: string) {
    this.busy.set(true); this.error.set('');
    try { this.moved((await this.data.staffAccept(id)).user); } catch (e) { this.error.set(errorText(e)); this.busy.set(false); }
  }

  async decline(id: string) {
    this.busy.set(true); this.error.set('');
    try { await this.data.staffDecline(id); this.msg.set('Invitation declined.'); await this.load(); } catch (e) { this.error.set(errorText(e)); }
    this.busy.set(false);
  }

  async join() {
    this.busy.set(true); this.error.set(''); this.msg.set('');
    try {
      const r = await this.data.staffJoin(this.orgCode.trim());
      if (r.result === 'JOINED') { const m = await this.data.staffMe(); this.moved({ ...this.auth.getUser(), role: m.role, tenantId: null }); return; }
      this.msg.set(r.result === 'ALREADY_MEMBER' ? `You're already in ${r.organization}.` : `Request sent to ${r.organization} — their Owner will approve you.`);
      this.orgCode = '';
      await this.load();
    } catch (e) { this.error.set(errorText(e)); }
    this.busy.set(false);
  }
}
