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
          <div><label>{{ editId() ? 'New password (leave blank to keep)' : 'Password' }} @if (!editId()) { <span class="req">*</span> }</label>
            <input name="password" type="password" [(ngModel)]="f.password" autocomplete="new-password" placeholder="At least 8 characters, a letter and a number" />
            <div class="help">Give this password to the user privately; ask them to change it later.</div></div>
          @if (editId()) {
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
      @else if (!canView()) { <div class="msg info">Only the Owner or a Director can see the user list.</div> }
      @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Modules</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr>
                  <td><strong>{{ u.fullName }}</strong><div class="help">{{ u.email }}{{ u.phone ? ' · ' + u.phone : '' }}</div></td>
                  <td><span class="tag gold">{{ u.role }}</span></td>
                  <td>{{ modLabel(u) }}</td>
                  <td>@if (u.isActive) { <span class="tag green">Active</span> } @else { <span class="tag warn">Blocked</span> }</td>
                  <td>{{ u.lastLoginAt ? both(u.lastLoginAt) : '—' }}</td>
                  <td>@if (canManage() && u.role !== 'SUPER_ADMIN') { <button class="btn light small" (click)="openEdit(u)">Edit</button> }</td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No users.</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </div>
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
    .tag.warn { background: #fef2f2; color: #b91c1c; }
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
  formError = signal('');
  canManage = computed(() => !!this.access.info()?.canManage);
  canView = computed(() => ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'].includes(this.access.info()?.role ?? this.me?.role));
  ws: Record<string, boolean> = Object.fromEntries(MENU.map((m) => [m.key, true]));
  f = this.empty();

  constructor() { this.init(); }

  async init() {
    const info = await this.access.load(true);
    this.ws = { ...this.ws, ...info.workspaceModules };
    await this.loadUsers();
  }
  async loadUsers() {
    this.loading.set(true);
    if (this.canView()) {
      try { this.users.set(await this.access.users()); } catch (e) { this.error.set(errorText(e)); }
    }
    this.loading.set(false);
  }

  empty() {
    return { email: '', fullName: '', phone: '', role: 'VIEWER', password: '', isActive: true, allModules: true, modules: [] as string[] };
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

  openNew() {
    this.editId.set('');
    this.f = this.empty();
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
  }
  openEdit(u: any) {
    this.editId.set(u.id);
    this.f = {
      email: u.email, fullName: u.fullName ?? '', phone: u.phone ?? '', role: u.role, password: '',
      isActive: u.isActive, allModules: !u.modules?.length, modules: [...(u.modules ?? [])],
    };
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async save() {
    const f = this.f;
    const editing = this.editId();
    if (!editing && !/^\S+@\S+\.\S+$/.test(f.email.trim())) { this.formError.set('Please enter a valid email.'); return; }
    if (!f.fullName.trim()) { this.formError.set('Please enter the full name.'); return; }
    if ((!editing || f.password) && !PASSWORD.test(f.password)) { this.formError.set('Password must be at least 8 characters with a letter and a number.'); return; }
    const modules = f.allModules ? [] : f.modules.filter((k) => k !== 'companies');
    if (!f.allModules && !modules.length) { this.formError.set('Tick at least one module, or choose "All modules".'); return; }
    const body: any = { fullName: f.fullName.trim(), phone: f.phone.trim(), role: f.role, modules };
    if (f.password) body.password = f.password;
    if (editing) body.isActive = f.isActive; else body.email = f.email.trim();
    this.saving.set(true);
    this.formError.set('');
    try {
      editing ? await this.access.updateUser(editing, body) : await this.access.createUser(body);
      this.showForm.set(false);
      this.okMsg.set(editing ? `✅ ${body.fullName} was updated.` : `✅ ${body.fullName} was added. They can sign in with ${body.email} and the password you set.`);
      await this.loadUsers();
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
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
}
