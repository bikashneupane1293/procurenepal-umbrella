import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './config';
import { ALL_ITEMS, MENU, itemById } from './modules';

export interface AccessInfo {
  role: string;
  canManage: boolean;
  canViewLogins?: boolean;
  modules: string[];
  workspaceModules: Record<string, boolean>;
  itemFlags?: Record<string, boolean>;
  /** Only these pages for this person (e.g. ['fleet.fuel'] = fuel entry only); null = no page limit */
  userItems?: string[] | null;
  /** Task 16 — few-pages staff: no reports, rates or amounts (Site Engineers and BOQ users excepted) */
  limitedView?: boolean;
  /** The workspace's plan and the module keys it may use (Task 8/9). Both are null when no plan
   *  has ever been recorded — meaning unrestricted, not "no modules". planCustom = true when
   *  Super Admin chose this workspace's modules explicitly (overriding the plan's defaults). */
  plan?: string | null;
  planModules?: string[] | null;
  planCustom?: boolean;
  /** Task 11 — where the plan stands, in Nepal dates */
  planState?: { plan: string | null; effectivePlan: string | null; state: 'NONE' | 'ACTIVE' | 'EXPIRING_SOON' | 'GRACE' | 'EXPIRED'; expiresOn: string | null; graceEndsOn: string | null; daysLeft: number | null };
}

/** Which ERP modules the signed-in user may open (loaded once per session). */
@Injectable({ providedIn: 'root' })
export class AccessService {
  private http = inject(HttpClient);
  info = signal<AccessInfo | null>(null);
  private loading: Promise<AccessInfo> | null = null;

  load(force = false): Promise<AccessInfo> {
    if (this.info() && !force) return Promise.resolve(this.info()!);
    if (this.loading && !force) return this.loading;
    this.loading = firstValueFrom(this.http.get<AccessInfo>(`${API_URL}/access/me`))
      .catch(() => ({
        // older backend or network problem: show everything, the server still checks each request
        role: '', canManage: false, modules: MENU.map((m) => m.key), workspaceModules: {},
      }))
      .then((i) => { this.info.set(i); this.loading = null; return i; });
    return this.loading;
  }

  can(moduleKey: string): boolean {
    const i = this.info();
    if (!i) return true;
    return i.modules.includes(moduleKey);
  }

  /** A single sidebar item switched off for the workspace (default: on). */
  canItem(itemId: string): boolean {
    const id = itemById(itemId)?.sameAccessAs ?? itemId; // e.g. phone fuel entry = Daily Fuel Log
    const i = this.info();
    if (i?.userItems && !i.userItems.includes(id)) return false;
    return i?.itemFlags?.[id] !== false;
  }

  /** For a person limited to some pages: the routes they may open (else null). */
  limitedRoutes(): string[] | null {
    const u = this.info()?.userItems;
    if (!u) return null;
    // the pages themselves first (in the order given), then their second screens (phone fuel entry …)
    const main = u.map((id) => itemById(id)?.route);
    const extra = ALL_ITEMS.filter((i) => i.sameAccessAs && u.includes(i.sameAccessAs)).map((i) => i.route);
    return [...main, ...extra].filter((r): r is string => !!r);
  }

  clear() { this.info.set(null); }

  // ---------- User Setup API ----------
  users() { return firstValueFrom(this.http.get<any[]>(`${API_URL}/users`)); }
  createUser(body: any) { return firstValueFrom(this.http.post<any>(`${API_URL}/users`, body)); }
  updateUser(id: string, body: any) { return firstValueFrom(this.http.patch<any>(`${API_URL}/users/${id}`, body)); }
  setWorkspaceModules(modules: Record<string, boolean>) {
    return firstValueFrom(this.http.put<Record<string, boolean>>(`${API_URL}/access/workspace-modules`, { modules }));
  }
  setWorkspaceItems(items: Record<string, boolean>) {
    return firstValueFrom(this.http.put<Record<string, boolean>>(`${API_URL}/access/workspace-items`, { items }));
  }
  activationLink(userId: string) { return firstValueFrom(this.http.post<any>(`${API_URL}/users/${userId}/activation-link`, {})); }
  loginSessions(userId?: string) {
    return firstValueFrom(this.http.get<any[]>(`${API_URL}/users/login-sessions`, { params: userId ? { userId } : {} }));
  }
}
