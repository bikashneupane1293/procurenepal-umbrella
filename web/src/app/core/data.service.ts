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
  updateCompany(id: string, body: any): Observable<any> {
    return this.http.patch(`${API_URL}/companies/${id}`, body);
  }
  deleteCompany(id: string): Observable<any> {
    return this.http.delete(`${API_URL}/companies/${id}`);
  }

  // ---------- Audited annual turnover ----------
  getTurnovers(companyId: string): Observable<any[]> {
    return this.http.get(`${API_URL}/companies/${companyId}/turnovers`).pipe(map(toList));
  }
  saveTurnovers(companyId: string, items: { fiscalYear: string; amount: number }[]): Observable<any[]> {
    return this.http.put(`${API_URL}/companies/${companyId}/turnovers`, { items }).pipe(map(toList));
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
  updateCertificate(id: string, body: any): Observable<any> {
    return this.http.patch(`${API_URL}/certificates/${id}`, body);
  }
  deleteCertificate(id: string): Observable<any> {
    return this.http.delete(`${API_URL}/certificates/${id}`);
  }

  // ---------- Tenders ----------
  getTenders(): Observable<any[]> {
    return this.http.get(`${API_URL}/tenders`).pipe(map(toList));
  }
  getTender(id: string): Observable<any> {
    return this.http.get(`${API_URL}/tenders/${id}`);
  }
  createTender(body: any): Observable<any> {
    return this.http.post(`${API_URL}/tenders`, body);
  }
  updateTender(id: string, body: any): Observable<any> {
    return this.http.patch(`${API_URL}/tenders/${id}`, body);
  }
  deleteTender(id: string): Observable<any> {
    return this.http.delete(`${API_URL}/tenders/${id}`);
  }

  // ---------- Qualification ----------
  evaluateCompany(tenderId: string, companyId: string): Observable<any> {
    return this.http.post(`${API_URL}/tenders/${tenderId}/evaluate/${companyId}`, {});
  }
  evaluateAll(tenderId: string): Observable<any> {
    return this.http.post(`${API_URL}/tenders/${tenderId}/evaluate-all`, {});
  }
  evaluateJv(tenderId: string, partners: { companyId: string; share: number; isLead?: boolean }[]): Observable<any> {
    return this.http.post(`${API_URL}/tenders/${tenderId}/evaluate-jv`, { partners });
  }
  jvPartners(tenderId: string, companyId: string): Observable<any> {
    return this.http.get(`${API_URL}/tenders/${tenderId}/jv-partners/${companyId}`);
  }
  getQualifications(tenderId: string): Observable<any[]> {
    return this.http.get(`${API_URL}/tenders/${tenderId}/qualifications`).pipe(map(toList));
  }
  quickCheck(body: any): Observable<any> {
    return this.http.post(`${API_URL}/qualification/evaluate`, body);
  }
  getRules(): Observable<any> {
    return this.http.get(`${API_URL}/qualification/rules`);
  }

  // ---------- Bid Information ----------
  getBids(filter: { tenderId?: string; status?: string; companyId?: string } = {}): Observable<any[]> {
    const q = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
    return this.http.get(`${API_URL}/bids${q ? '?' + q : ''}`).pipe(map(toList));
  }
  getBid(id: string): Observable<any> {
    return this.http.get(`${API_URL}/bids/${id}`);
  }
  createBid(body: any): Observable<any> {
    return this.http.post(`${API_URL}/bids`, body);
  }
  updateBid(id: string, body: any): Observable<any> {
    return this.http.patch(`${API_URL}/bids/${id}`, body);
  }
  deleteBid(id: string): Observable<any> {
    return this.http.delete(`${API_URL}/bids/${id}`);
  }

  // ---------- Bolpatra Reports ----------
  getReport(days = 30): Observable<any> {
    return this.http.get(`${API_URL}/bolpatra/reports?days=${days}`);
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
