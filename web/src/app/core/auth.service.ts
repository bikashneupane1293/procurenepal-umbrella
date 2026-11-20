import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { API_URL, HOME_URL } from './config';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);
  private http = inject(HttpClient);

  saveSession(token: string, user: any): void {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getUser(): any {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  }

  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(part));
      return !payload.exp || payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  /** toHome = the person pressed Logout: go back to the ProcureNepal home page (procurenepal.com).
   *  An expired session (401) still goes to the sign-in page. */
  logout(toHome = false): void {
    // best-effort: close the sign-in session on the server (Task 5 login history)
    this.http.post(`${API_URL}/auth/logout`, {}).subscribe({ next: () => {}, error: () => {} });
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (toHome && location.hostname.endsWith('procurenepal.com')) { location.href = HOME_URL; return; }
    this.router.navigate(['/login']);
  }
}
