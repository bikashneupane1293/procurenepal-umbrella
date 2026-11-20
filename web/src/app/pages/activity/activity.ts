import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../../core/config';
import { errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { tablesToExcel } from '../../core/erp-sheets';

/** Who added, changed or deleted what (Task 15). Owners and Directors. */
@Component({
  selector: 'app-activity',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <h1>🕑 Activity Log</h1>
    <p class="sub">Every change made in your workspace — newest first, Nepal Time. Reading pages is not logged.</p>
    @if (error()) { <div class="msg error">{{ error() }}</div> }
    <div class="panel">
      <div class="bar tight">
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Search person, item or detail…" class="search" />
        <span class="help">{{ shown().length }} of {{ rows().length }}</span>
        <button class="btn light small" (click)="excel()" [disabled]="exporting()">{{ exporting() ? 'Preparing…' : '⬇️ Download Excel (for audit)' }}</button>
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Detail</th></tr></thead>
        <tbody>
          @for (r of shown(); track r.id) {
            <tr>
              <td class="nowrap">{{ r.at | date: 'yyyy-MM-dd HH:mm' }}</td>
              <td>{{ r.who }}</td>
              <td><span class="act" [class]="'act ' + r.action">{{ r.action }}</span> {{ r.what }}</td>
              <td class="muted">{{ r.detail }}</td>
            </tr>
          } @empty { <tr><td colspan="4" class="muted">{{ loading() ? 'Loading…' : 'Nothing yet — changes appear here as people work.' }}</td></tr> }
        </tbody>
      </table></div>
    </div>
  `,
  styles: [UI_STYLES, `
    .search { max-width: 340px; }
    .nowrap { white-space: nowrap; }
    .muted { color: #6b7280; font-size: 13px; }
    .act { font-size: 11px; font-weight: 800; text-transform: uppercase; padding: 2px 7px; border-radius: 8px; background: #eef0f2; color: #374151; margin-right: 4px; }
    .act.added { background: #dcfce7; color: #15803d; } .act.changed, .act.saved { background: #fef5e0; color: #8a6508; } .act.deleted { background: #fee2e2; color: #b91c1c; }
  `],
})
export class ActivityPage {
  private http = inject(HttpClient);
  rows = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  q = signal('');
  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return q ? this.rows().filter((r) => `${r.who} ${r.email ?? ''} ${r.action} ${r.what} ${r.detail}`.toLowerCase().includes(q)) : this.rows();
  });
  exporting = signal(false);
  /** Excel of the whole log (up to 5,000 latest changes) — or of the search result when a search is typed */
  async excel() {
    this.exporting.set(true);
    try {
      const q = this.q().trim();
      const all = q ? this.shown() : await firstValueFrom(this.http.get<any[]>(`${API_URL}/activity?limit=5000`));
      const when = (v: string) => { const d = new Date(new Date(v).getTime() + 345 * 60000).toISOString(); return d.slice(0, 10) + ' ' + d.slice(11, 19); };
      tablesToExcel('Activity_Log', [{
        title: 'Activity log',
        columns: [{ k: 'when', label: 'When (Nepal Time)' }, { k: 'who', label: 'Who' }, { k: 'email', label: 'Email' }, { k: 'action', label: 'Action' }, { k: 'what', label: 'What' }, { k: 'detail', label: 'Detail' }, { k: 'ip', label: 'IP address' }],
        rows: all.map((r) => ({ ...r, when: when(r.at), email: r.email ?? '', ip: r.ip ?? '' })),
      }], [{ label: 'Rows', value: all.length, hint: q ? `search: "${q}"` : 'latest changes, newest first (max 5,000)' }, { label: 'Exported (Nepal Time)', value: when(new Date().toISOString()) }]);
    } catch (e) { this.error.set(errorText(e)); }
    this.exporting.set(false);
  }

  constructor() {
    firstValueFrom(this.http.get<any[]>(`${API_URL}/activity`))
      .then((l) => this.rows.set(l)).catch((e) => this.error.set(errorText(e))).finally(() => this.loading.set(false));
  }
}
