import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './config';
import { MENU } from './modules';

export interface AccessInfo {
  role: string;
  canManage: boolean;
  canViewLogins?: boolean;
  modules: string[];
  workspaceModules: Record<string, boolean>;
  itemFlags?: Record<string, boolean>;
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
    const f = this.info()?.itemFlags;
    return f?.[itemId] !== false;
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
