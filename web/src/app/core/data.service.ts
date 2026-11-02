import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_URL } from './config';

// Accepts either a plain list or a list wrapped as { data: [...] } / { items: [...] }
function toList(res: any): any[] {
  if (Array.isArray(res)) return res;
  return res?.data ?? res?.items ?? res?.results ?? [];
}

@Injectable({ providedIn: 'root' })
export class DataService {
  private http = inject(HttpClient);

  // ---------- Companies ----------
  getCompanies(): Observable<any[]> {
    return this.http.get(`${API_URL}/companies`).pipe(map(toList));
  }
  createCompany(body: any): Observable<any> {
    return this.http.post(`${API_URL}/companies`, body);
  }
  deleteCompany(id: string): Observable<any> {
    return this.http.delete(`${API_URL}/companies/${id}`);
  }

  // ---------- Certificates ----------
  getCertificates(companyId?: string): Observable<any[]> {
    const url = companyId
      ? `${API_URL}/companies/${companyId}/certificates`
      : `${API_URL}/certificates`;
    return this.http.get(url).pipe(map(toList));
  }
  createCertificate(companyId: string, body: any): Observable<any> {
    return this.http.post(`${API_URL}/companies/${companyId}/certificates`, body);
  }
  deleteCertificate(id: string): Observable<any> {
    return this.http.delete(`${API_URL}/certificates/${id}`);
  }

  // ---------- Tenders ----------
  getTenders(): Observable<any[]> {
    return this.http.get(`${API_URL}/tenders`).pipe(map(toList));
  }
}

// Turns any backend error into one readable sentence
export function errorText(err: any): string {
  const m = err?.error?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string') return m;
  if (err?.status === 0) return 'Cannot reach the server. Please wait a minute and try again.';
  return err?.message || 'Something went wrong';
}
