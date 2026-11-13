import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessService } from '../../core/access.service';
import { AuthService } from '../../core/auth.service';
import { errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { MENU } from '../../core/modules';
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
        <p class="help">Switch a whole module on or off for everyone in your workspace. A switched-off module disappears from every menu and its data cannot be opened. Companies is always on.</p>
        <div class="mods">
          @for (m of menu; track m.key) {
            <label class="mod" [class.off]="!ws[m.key]">
              <input type="checkbox" [checked]="ws[m.key]" [disabled]="m.core" (change)="ws[m.key] = !ws[m.key]" />
              <span>{{ m.icon }} {{ m.label }}</span>
              <small>{{ builtCount(m.key) }} of {{ m.items.length }} screens ready</small>
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
        <label class="inline all"><input type="checkbox" name="allMods" [(ngModel)]="f.allModules" /> All modules active in the workspace (recommended for Owners and Directors)</label>
        @if (!f.allModules) {
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
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 20px 0 10px; }
    .mods { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; margin: 8px 0; }
    .mod { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border: 1px solid #e1e3e6; border-radius: 8px; padding: 10px 12px; font-weight: 600; color: #0a1f3d; margin: 0; cursor: pointer; }
    .mod input { width: auto; }
    .mod small { width: 100%; font-weight: 400; color: #9ca3af; font-size: 11px; padding-left: 24px; }
    .mod.off { background: #f9fafb; color: #9ca3af; }
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
    .linkbox { display: flex; align-items: center; gap: 10px; background: #f8f9fa; border-radius: 8px; padding: 10px 14px; flex-wrap: wrap; }
    .linkbox code { word-break: break-all; font-size: 13px; }
  `],
})
export class UsersPage {
  private access = inject(AccessService);
  private auth = inject(AuthService);
  menu = MENU;
  roles = ROLES;
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
  ws: Record<string, boolean> = Object.fromEntries(MENU.map((m) => [m.key, true]));
  wsItems: Record<string, boolean> = {};
  f = this.empty();

  constructor() { this.init(); }

  async init() {
    const info = await this.access.load(true);
    this.ws = { ...this.ws, ...info.workspaceModules };
    this.wsItems = { ...(info.itemFlags ?? {}) };
    await this.loadUsers();
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
    return { email: '', fullName: '', phone: '', role: 'VIEWER', password: '', customTitle: '', isActive: true, allModules: true, modules: [] as string[] };
  }
  both(d: any) { return showBoth(String(d)); }
  builtCount(key: string) { return MENU.find((m) => m.key === key)!.items.filter((i) => i.status === 'built').length; }
  modLabel(u: any) {
    if (['OWNER', 'SUPER_ADMIN'].includes(u.role) || !u.modules?.length) return 'All active modules';
    return ['companies', ...u.modules].map((k: string) => MENU.find((m) => m.key === k)?.label ?? k).join(', ');
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
      customTitle: u.customTitle ?? '', isActive: u.isActive, allModules: !u.modules?.length, modules: [...(u.modules ?? [])],
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
    const modules = f.allModules ? [] : f.modules.filter((k) => k !== 'companies');
    if (!f.allModules && !modules.length) { this.formError.set('Tick at least one module, or choose "All modules".'); return; }
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
          ? `✅ ${body.fullName} was added. Send them the activation link below so they can set their own password.`
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
