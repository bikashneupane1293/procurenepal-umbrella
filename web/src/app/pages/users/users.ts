import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessService } from '../../core/access.service';
import { AuthService } from '../../core/auth.service';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { MENU, itemById } from '../../core/modules';
import { showBoth } from '../../core/nepali-date';

const ROLES: { value: string; label: string }[] = [
  { value: 'OWNER', label: 'Owner (everything + user setup)' },
  { value: 'DIRECTOR', label: 'Director (can delete tenders)' },
  { value: 'PROJECT_DIRECTOR', label: 'Project Director' },
  { value: 'PROCUREMENT_OFFICER', label: 'Procurement Officer' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
  { value: 'STORE_MANAGER', label: 'Store Manager' },
  { value: 'SITE_ENGINEER', label: 'Site Engineer' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'HR_MANAGER', label: 'HR and Operations' },
  { value: 'VIEWER', label: 'Viewer (read only)' },
];
const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="bar">
      <div>
        <h1>User Setup System</h1>
        <p class="sub">Add the people who use ProcureNepal, give each a role, and choose which modules they can open.</p>
      </div>
      @if (canManage() && !showForm()) { <button class="btn gold" (click)="openNew()">+ Add User</button> }
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }
    @if (error()) { <div class="msg error">{{ error() }}</div> }

    @if (canManage() && org(); as o) {
      <div class="panel staff">
        <h2>👥 Staff joining &amp; leaving</h2>
        <div class="orgrow">
          <div>
            <div class="lbl">Your Org ID</div>
            <div class="orgcode">{{ o.orgCode }}</div>
          </div>
          <div class="orgbtns">
            <button class="btn light small" (click)="copyText(o.orgCode, 'id')">{{ copiedWhat() === 'id' ? '✅ Copied' : '📋 Copy ID' }}</button>
            <button class="btn light small" (click)="copyText(o.signupLink, 'link')">{{ copiedWhat() === 'link' ? '✅ Copied' : '🔗 Copy sign-up link' }}</button>
            <button class="btn light small" (click)="regenerateOrg()" title="Use if the ID was shared too widely — the old one stops working">↻ New ID</button>
          </div>
        </div>
        <p class="help">Give staff this Org ID (or the link). They sign up with it — with Google, if you've already added their email they join at once; otherwise you approve them below. When someone leaves, <strong>Remove</strong> them: they keep their login as a free user, and their next company can add them.</p>

        <div class="addrow">
          <input [(ngModel)]="inviteTarget" placeholder="Email or personal ID (U-XXXXXX)" />
          <select [(ngModel)]="inviteRole">@for (r of roles; track r.value) { <option [value]="r.value">{{ r.label }}</option> }</select>
          <button class="btn gold" (click)="sendInvite()" [disabled]="staffBusy() || !inviteTarget.trim()">Add staff</button>
        </div>

        @if (pending().length) {
          <div class="table-wrap"><table>
            <thead><tr><th>Person</th><th>Type</th><th>Role</th><th></th></tr></thead>
            <tbody>
              @for (i of pending(); track i.id) {
                <tr>
                  <td><strong>{{ i.fullName || i.email || i.userCode }}</strong><div class="help">{{ i.email }}{{ i.userCode ? ' · ' + i.userCode : '' }}</div></td>
                  <td>@if (i.kind === 'REQUEST') { <span class="tag warn">Asked to join</span> } @else { <span class="tag">Invited — waiting for them</span> }</td>
                  <td>
                    @if (i.kind === 'REQUEST') {
                      <select [(ngModel)]="approveRole[i.id]">@for (r of roles; track r.value) { <option [value]="r.value">{{ r.label }}</option> }</select>
                    } @else { <span class="tag gold">{{ i.role }}</span> }
                  </td>
                  <td class="rowbtns">
                    @if (i.kind === 'REQUEST') { <button class="btn gold small" (click)="approve(i)" [disabled]="staffBusy()">Approve</button> }
                    <button class="btn light small" (click)="cancelInvite(i)" [disabled]="staffBusy()">{{ i.kind === 'REQUEST' ? 'Decline' : 'Cancel' }}</button>
                  </td>
                </tr>
              }
            </tbody>
          </table></div>
        }
      </div>
    }

    @if (activationLink()) {
      <div class="panel link-panel">
        <h2>🔗 Activation link</h2>
        <p class="help">Email sending isn't set up yet, so send this link to the new user yourself (WhatsApp, SMS, email). They will open it and choose their own password. The link works for 7 days.</p>
        <div class="linkbox">
          <code>{{ fullLink(activationLink()!) }}</code>
          <button class="btn light small" (click)="copyLink(activationLink()!)">{{ copied() ? '✅ Copied' : '📋 Copy' }}</button>
        </div>
      </div>
    }

    @if (canManage()) {
      <div class="panel">
        <h2>Workspace modules (activation)</h2>
        <p class="help">Switch a whole module on or off for everyone in your workspace. A switched-off module disappears from every menu and its data cannot be opened. Companies is always on.
          @if (plan()) { Your workspace is on the <strong>{{ plan() }}</strong> plan. }
        </p>
        <div class="mods">
          @for (m of menu; track m.key) {
            <label class="mod" [class.off]="!ws[m.key]" [class.locked]="lockedByPlan(m.key)">
              <input type="checkbox" [checked]="ws[m.key]" [disabled]="m.core || lockedByPlan(m.key)" (change)="ws[m.key] = !ws[m.key]" />
              <span>{{ m.icon }} {{ m.label }}</span>
              @if (lockedByPlan(m.key)) {
                <small>🔒 Not included for your workspace — ask your ProcureNepal administrator to add it</small>
              } @else {
                <small>{{ builtCount(m.key) }} of {{ m.items.length }} screens ready</small>
              }
            </label>
          }
        </div>
        <div class="actions"><button class="btn" (click)="saveModules()" [disabled]="savingMods()">{{ savingMods() ? 'Saving…' : 'Save module activation' }}</button></div>
      </div>

      <div class="panel">
        <h2>Sidebar items (fine control)</h2>
        <p class="help">Switch off a single screen within an active module — the rest of the module stays on. Useful for a submenu nobody on your team uses yet.</p>
        @for (m of menu; track m.key) {
          @if (ws[m.key]) {
            <details class="itemgrp">
              <summary>{{ m.icon }} {{ m.label }} <small>({{ m.items.length }} items)</small></summary>
              <div class="mods">
                @for (i of m.items; track i.id) {
                  <label class="mod" [class.off]="wsItems[i.id] === false">
                    <input type="checkbox" [checked]="wsItems[i.id] !== false" (change)="wsItems[i.id] = wsItems[i.id] === false ? true : false" />
                    <span>{{ i.label }}</span>
                  </label>
                }
              </div>
            </details>
          }
        }
        <div class="actions"><button class="btn" (click)="saveItems()" [disabled]="savingItems()">{{ savingItems() ? 'Saving…' : 'Save sidebar items' }}</button></div>
      </div>
    }

    @if (showForm()) {
      <form class="panel" (ngSubmit)="save()">
        <h2>{{ editId() ? 'Edit User' : 'New User' }}</h2>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }
        <div class="grid">
          <div><label>Email (login) <span class="req">*</span></label>
            <input name="email" type="email" [(ngModel)]="f.email" [disabled]="!!editId()" placeholder="e.g. accounts@cuidado.com" /></div>
          <div><label>Full Name <span class="req">*</span></label>
            <input name="fullName" [(ngModel)]="f.fullName" placeholder="e.g. Sita Sharma" /></div>
          <div><label>Phone</label>
            <input name="phone" [(ngModel)]="f.phone" placeholder="e.g. 98XXXXXXXX" /></div>
          <div><label>Role <span class="req">*</span></label>
            <select name="role" [(ngModel)]="f.role">@for (r of roles; track r.value) { <option [value]="r.value">{{ r.label }}</option> }</select></div>
          <div><label>Custom title shown on screen (optional)</label>
            <input name="customTitle" [(ngModel)]="f.customTitle" placeholder="e.g. Site Supervisor – Butwal" />
            <div class="help">Shown instead of the role name in the user list. The role above still controls what they can do.</div></div>
          @if (!editId()) {
            <div><label>Password (optional)</label>
              <input name="password" type="password" [(ngModel)]="f.password" autocomplete="new-password" placeholder="Leave blank to send an activation link instead" />
              <div class="help">Leave blank: the user gets a link to set their own password. Fill it in to activate the account yourself, right now.</div></div>
          } @else {
            <div><label>New password (leave blank to keep)</label>
              <input name="password" type="password" [(ngModel)]="f.password" autocomplete="new-password" placeholder="At least 8 characters, a letter and a number" /></div>
            <div><label class="inline"><input type="checkbox" name="active" [(ngModel)]="f.isActive" /> Account active</label>
              <div class="help">Untick to block sign-in without deleting the user.</div></div>
          }
        </div>
        <h3>Modules this user can open</h3>
        <label class="inline all"><input type="checkbox" name="pagesOnly" [(ngModel)]="f.pagesOnly" /> Only specific pages (for example a driver who may only enter fuel in the Daily Fuel Log)</label>
        @if (f.pagesOnly) {
          <div class="help">This person sees only the pages ticked below — no Dashboard, no other pages. Drop-down lists they need (vehicles, employees, projects) still work.</div>
          <div class="pages">
            @for (m of pageMenu; track m.key) {
              <div class="pgroup"><strong>{{ m.icon }} {{ m.label }}</strong>
                @for (i of m.items; track i.id) {
                  <label class="inline"><input type="checkbox" [checked]="f.items.includes(i.id)" (change)="toggleItem(i.id)" /> {{ i.label }}</label>
                }
              </div>
            }
          </div>
        } @else {
        <label class="inline all"><input type="checkbox" name="allMods" [(ngModel)]="f.allModules" /> All modules active in the workspace (recommended for Owners and Directors)</label>
        }
        @if (!f.allModules && !f.pagesOnly) {
          <div class="mods">
            @for (m of menu; track m.key) {
              <label class="mod" [class.off]="!ws[m.key]">
                <input type="checkbox" [checked]="m.core || f.modules.includes(m.key)" [disabled]="m.core" (change)="toggleMod(m.key)" />
                <span>{{ m.icon }} {{ m.label }}</span>
                @if (!ws[m.key]) { <small>switched off for the workspace</small> }
              </label>
            }
          </div>
        }
        @if (f.role === 'OWNER') { <div class="help">Owners always see every active module.</div> }
        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : (editId() ? 'Save Changes' : 'Add User') }}</button>
          <button class="btn light" type="button" (click)="showForm.set(false)">Cancel</button>
        </div>
      </form>
    }

    <div class="panel">
      @if (loading()) { <div class="msg info">Loading users…</div> }
      @else if (!canView()) { <div class="msg info">Only the Owner, a Director, or HR and Operations can see the user list.</div> }
      @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Modules</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr>
                  <td><strong>{{ u.fullName }}</strong><div class="help">{{ u.customTitle || u.email }}{{ u.customTitle ? '' : (u.phone ? ' · ' + u.phone : '') }}</div></td>
                  <td><span class="tag gold">{{ u.role }}</span></td>
                  <td>{{ modLabel(u) }}</td>
                  <td>
                    @if (u.status === 'PENDING') { <span class="tag warn">Pending activation</span> }
                    @else if (u.isActive) { <span class="tag green">Active</span> }
                    @else { <span class="tag warn">Blocked</span> }
                  </td>
                  <td>{{ u.lastLoginAt ? both(u.lastLoginAt) : '—' }}</td>
                  <td class="rowbtns">
                    @if (canManage() && u.status === 'PENDING') { <button class="btn light small" (click)="newLink(u)">New link</button> }
                    @if (canManage() && u.role !== 'SUPER_ADMIN') { <button class="btn light small" (click)="openEdit(u)">Edit</button> }
                    @if (canManage() && u.role !== 'SUPER_ADMIN' && u.id !== myId) { <button class="btn light small" (click)="removeUser(u)" title="They keep their login as a free user">Remove</button> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No users.</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (canViewLogins()) {
      <div class="panel">
        <h2>Sign-in / sign-out history</h2>
        <p class="help">Visible to the Owner and HR and Operations. "Open" means the user has not signed out yet (or closed the browser tab without signing out).</p>
        @if (loadingLogins()) { <div class="msg info">Loading…</div> }
        @else {
          <div class="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Signed in</th><th>Signed out</th></tr></thead>
              <tbody>
                @for (s of sessions(); track s.id) {
                  <tr>
                    <td>{{ s.user?.fullName ?? '—' }}</td>
                    <td>{{ both(s.loginAt) }}</td>
                    <td>{{ s.logoutAt ? both(s.logoutAt) : 'Open' }}</td>
                  </tr>
                } @empty { <tr><td colspan="3" class="empty">No sign-ins recorded yet.</td></tr> }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  `,
  styles: [UI_STYLES, `
    .pages { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px 20px; margin: 8px 0 12px; }
    .pgroup { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .pgroup strong { color: #0a1f3d; margin-bottom: 2px; }
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 20px 0 10px; }
    .mods { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; margin: 8px 0; }
    .mod { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border: 1px solid #e1e3e6; border-radius: 8px; padding: 10px 12px; font-weight: 600; color: #0a1f3d; margin: 0; cursor: pointer; }
    .mod input { width: auto; }
    .mod small { width: 100%; font-weight: 400; color: #9ca3af; font-size: 11px; padding-left: 24px; }
    .mod.off { background: #f9fafb; color: #9ca3af; }
    .mod.locked { background: #fff7e6; border-color: #e6c870; cursor: not-allowed; }
    .mod.locked small { color: #a16a00; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; font-weight: 600; }
    label.inline input { width: auto; }
    .all { margin-bottom: 6px; }
    .btn.small { padding: 6px 12px; }
    .rowbtns { display: flex; gap: 6px; }
    .tag.warn { background: #fef2f2; color: #b91c1c; }
    .itemgrp { border: 1px solid #e1e3e6; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; }
    .itemgrp summary { cursor: pointer; font-weight: 700; color: #0a1f3d; padding: 4px 0; }
    .itemgrp summary small { color: #9ca3af; font-weight: 400; }
    .link-panel { border-left: 4px solid #d4a017; }
    .staff .orgrow { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .staff .lbl { font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
    .staff .orgcode { font-size: 28px; font-weight: 800; color: #0a1f3d; letter-spacing: .05em; }
    .staff .orgbtns { display: flex; gap: 8px; flex-wrap: wrap; }
    .staff .addrow { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .staff .addrow input { flex: 2 1 240px; } .staff .addrow select { flex: 1 1 200px; width: auto; }
    .linkbox { display: flex; align-items: center; gap: 10px; background: #f8f9fa; border-radius: 8px; padding: 10px 14px; flex-wrap: wrap; }
    .linkbox code { word-break: break-all; font-size: 13px; }
  `],
})
export class UsersPage {
  private access = inject(AccessService);
  private auth = inject(AuthService);
  menu = MENU;
  roles = ROLES;
  // ---- Task 12: staff joining & leaving
  private staffApi = inject(DataService);
  myId = inject(AuthService).getUser()?.id ?? '';
  org = signal<any | null>(null);
  pending = signal<any[]>([]);
  staffBusy = signal(false);
  copiedWhat = signal('');
  inviteTarget = '';
  inviteRole = 'VIEWER';
  approveRole: Record<string, string> = {};

  async loadStaff() {
    if (!this.canManage()) return;
    try {
      const [o, p] = await Promise.all([this.staffApi.staffOrg(), this.staffApi.staffInvites()]);
      this.org.set(o);
      for (const i of p) if (!this.approveRole[i.id]) this.approveRole[i.id] = i.role || 'VIEWER';
      this.pending.set(p);
    } catch (e) { this.error.set(errorText(e)); }
  }
  async copyText(v: string, what: string) {
    try { await navigator.clipboard.writeText(v); this.copiedWhat.set(what); setTimeout(() => this.copiedWhat.set(''), 2500); } catch { /* clipboard blocked */ }
  }
  async regenerateOrg() {
    if (!confirm('Make a new Org ID? The current one stops working for new sign-ups.')) return;
    try { this.org.set(await this.staffApi.staffRegenerateOrg()); this.okMsg.set('✅ New Org ID made. Give staff the new one.'); } catch (e) { this.error.set(errorText(e)); }
  }
  async sendInvite() {
    this.staffBusy.set(true); this.error.set(''); this.okMsg.set('');
    try {
      const r = await this.staffApi.staffInvite({ target: this.inviteTarget.trim(), role: this.inviteRole });
      const who = r.invite.email || r.invite.userCode;
      this.okMsg.set(r.existingAccount
        ? `✅ Invitation sent to ${who}. They accept it on their Account page${r.emailed ? ' (we emailed them)' : ''}.`
        : `✅ ${who} is added. Ask them to sign up with Google using this email and your Org ID ${this.org()?.orgCode} — they'll join at once${r.emailed ? ' (we emailed them the link)' : ''}.`);
      this.inviteTarget = '';
      await this.loadStaff();
    } catch (e) { this.error.set(errorText(e)); }
    this.staffBusy.set(false);
  }
  async approve(i: any) {
    this.staffBusy.set(true); this.error.set('');
    try { await this.staffApi.staffApprove(i.id, { role: this.approveRole[i.id] }); this.okMsg.set(`✅ ${i.fullName || i.email} joined your workspace.`); await Promise.all([this.loadStaff(), this.loadUsers()]); }
    catch (e) { this.error.set(errorText(e)); }
    this.staffBusy.set(false);
  }
  async cancelInvite(i: any) {
    this.staffBusy.set(true); this.error.set('');
    try { await this.staffApi.staffCancel(i.id); await this.loadStaff(); } catch (e) { this.error.set(errorText(e)); }
    this.staffBusy.set(false);
  }
  async removeUser(u: any) {
    if (!confirm(`Remove ${u.fullName} from this workspace?\n\nThey keep their login and become a free user; their records stay here.`)) return;
    this.error.set(''); this.okMsg.set('');
    try { await this.staffApi.staffRemove(u.id); this.okMsg.set(`✅ ${u.fullName} was removed. They're now a free user and another company can add them.`); await this.loadUsers(); }
    catch (e) { this.error.set(errorText(e)); }
  }
  me = this.auth.getUser();

  users = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  okMsg = signal('');
  showForm = signal(false);
  editId = signal('');
  saving = signal(false);
  savingMods = signal(false);
  savingItems = signal(false);
  formError = signal('');
  activationLink = signal<string | null>(null);
  copied = signal(false);
  sessions = signal<any[]>([]);
  loadingLogins = signal(false);
  canManage = computed(() => !!this.access.info()?.canManage);
  canView = computed(() => ['OWNER', 'SUPER_ADMIN', 'DIRECTOR', 'HR_MANAGER'].includes(this.access.info()?.role ?? this.me?.role));
  canViewLogins = computed(() => !!this.access.info()?.canViewLogins);
  plan = computed(() => this.access.info()?.plan ?? '');
  planModules = computed(() => this.access.info()?.planModules ?? null);
  /** true only once we actually know the plan's module list — avoids locking everything while loading */
  lockedByPlan(key: string): boolean {
    const allowed = this.planModules();
    return !!allowed && !MENU.find((m) => m.key === key)?.core && !allowed.includes(key);
  }
  ws: Record<string, boolean> = Object.fromEntries(MENU.map((m) => [m.key, true]));
  wsItems: Record<string, boolean> = {};
  f = this.empty();

  constructor() { this.init(); }

  async init() {
    const info = await this.access.load(true);
    this.ws = { ...this.ws, ...info.workspaceModules };
    this.wsItems = { ...(info.itemFlags ?? {}) };
    await this.loadUsers();
    this.loadStaff();
    if (this.canViewLogins()) this.loadLogins();
  }
  async loadUsers() {
    this.loading.set(true);
    if (this.canView()) {
      try { this.users.set(await this.access.users()); } catch (e) { this.error.set(errorText(e)); }
    }
    this.loading.set(false);
  }
  async loadLogins() {
    this.loadingLogins.set(true);
    try { this.sessions.set(await this.access.loginSessions()); } catch { /* not critical */ }
    this.loadingLogins.set(false);
  }

  empty() {
    return { email: '', fullName: '', phone: '', role: 'VIEWER', password: '', customTitle: '', isActive: true, allModules: true, modules: [] as string[], pagesOnly: false, items: [] as string[] };
  }
  both(d: any) { return showBoth(String(d)); }
  builtCount(key: string) { return MENU.find((m) => m.key === key)!.items.filter((i) => i.status === 'built').length; }
  modLabel(u: any) {
    if (['OWNER', 'SUPER_ADMIN'].includes(u.role) || !u.modules?.length) return 'All active modules';
    const items = u.modules.filter((k: string) => k.startsWith('item:'));
    if (items.length) return 'Only: ' + items.map((k: string) => itemById(k.slice(5))?.label ?? k.slice(5)).join(', ');
    return ['companies', ...u.modules].map((k: string) => MENU.find((m) => m.key === k)?.label ?? k).join(', ');
  }
  /** pages that can be given on their own (built, outside the Companies module) */
  pageMenu = MENU.filter((m) => !m.core).map((m) => ({ ...m, items: m.items.filter((i) => i.status === 'built') })).filter((m) => m.items.length);
  toggleItem(id: string) {
    this.f.items = this.f.items.includes(id) ? this.f.items.filter((k) => k !== id) : [...this.f.items, id];
  }
  toggleMod(key: string) {
    this.f.modules = this.f.modules.includes(key) ? this.f.modules.filter((k) => k !== key) : [...this.f.modules, key];
  }
  fullLink(path: string) { return `${location.origin}${path}`; }
  async copyLink(path: string) {
    try { await navigator.clipboard.writeText(this.fullLink(path)); this.copied.set(true); setTimeout(() => this.copied.set(false), 2500); } catch { /* clipboard blocked */ }
  }

  openNew() {
    this.editId.set('');
    this.f = this.empty();
    this.formError.set('');
    this.okMsg.set('');
    this.activationLink.set(null);
    this.showForm.set(true);
  }
  openEdit(u: any) {
    this.editId.set(u.id);
    this.f = {
      email: u.email, fullName: u.fullName ?? '', phone: u.phone ?? '', role: u.role, password: '',
      customTitle: u.customTitle ?? '', isActive: u.isActive, allModules: !u.modules?.length,
      modules: (u.modules ?? []).filter((k: string) => !k.startsWith('item:')),
      pagesOnly: (u.modules ?? []).some((k: string) => k.startsWith('item:')),
      items: (u.modules ?? []).filter((k: string) => k.startsWith('item:')).map((k: string) => k.slice(5)),
    };
    this.formError.set('');
    this.okMsg.set('');
    this.activationLink.set(null);
    this.showForm.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async save() {
    const f = this.f;
    const editing = this.editId();
    if (!editing && !/^\S+@\S+\.\S+$/.test(f.email.trim())) { this.formError.set('Please enter a valid email.'); return; }
    if (!f.fullName.trim()) { this.formError.set('Please enter the full name.'); return; }
    if (f.password && !PASSWORD.test(f.password)) { this.formError.set('Password must be at least 8 characters with a letter and a number.'); return; }
    let modules = f.allModules ? [] : f.modules.filter((k) => k !== 'companies');
    if (f.pagesOnly) {
      if (!f.items.length) { this.formError.set('Tick at least one page, or untick "Only specific pages".'); return; }
      if (['OWNER', 'SUPER_ADMIN'].includes(f.role)) { this.formError.set('Owners always see everything — page limits are for other roles.'); return; }
      modules = f.items.map((id) => 'item:' + id);
    } else if (!f.allModules && !modules.length) { this.formError.set('Tick at least one module, or choose "All modules".'); return; }
    const body: any = { fullName: f.fullName.trim(), phone: f.phone.trim(), role: f.role, modules, customTitle: f.customTitle.trim() };
    if (f.password) body.password = f.password;
    if (editing) body.isActive = f.isActive; else body.email = f.email.trim();
    this.saving.set(true);
    this.formError.set('');
    try {
      if (editing) {
        await this.access.updateUser(editing, body);
        this.okMsg.set(`✅ ${body.fullName} was updated.`);
      } else {
        const created = await this.access.createUser(body);
        this.okMsg.set(created.activationLink
          ? created.emailed
            ? `✅ ${body.fullName} was added and the activation link was emailed to ${body.email} (also shown below in case it doesn't arrive).`
            : `✅ ${body.fullName} was added. Send them the activation link below so they can set their own password.`
          : `✅ ${body.fullName} was added. They can sign in with ${body.email} and the password you set.`);
        this.activationLink.set(created.activationLink ?? null);
      }
      this.showForm.set(false);
      await this.loadUsers();
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }

  async newLink(u: any) {
    this.error.set('');
    try {
      const r = await this.access.activationLink(u.id);
      this.activationLink.set(r.activationLink);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { this.error.set(errorText(e)); }
  }

  async saveModules() {
    this.savingMods.set(true);
    this.error.set('');
    try {
      const changes = Object.fromEntries(MENU.filter((m) => !m.core).map((m) => [m.key, !!this.ws[m.key]]));
      this.ws = { ...this.ws, ...(await this.access.setWorkspaceModules(changes)) };
      await this.access.load(true); // refresh the menu
      const off = MENU.filter((m) => !this.ws[m.key]).map((m) => m.label);
      this.okMsg.set(off.length ? `✅ Saved. Switched off: ${off.join(', ')}.` : '✅ Saved. All modules are on.');
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.savingMods.set(false);
  }

  async saveItems() {
    this.savingItems.set(true);
    this.error.set('');
    try {
      const allItemIds = MENU.flatMap((m) => m.items.map((i) => i.id));
      const changes = Object.fromEntries(allItemIds.map((id) => [id, this.wsItems[id] !== false]));
      this.wsItems = await this.access.setWorkspaceItems(changes);
      await this.access.load(true); // refresh the sidebar
      this.okMsg.set('✅ Sidebar items saved.');
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.savingItems.set(false);
  }
}
