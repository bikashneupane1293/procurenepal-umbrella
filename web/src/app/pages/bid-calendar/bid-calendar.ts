import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { adToBs } from '../../core/nepali-date';
import { addNptDays, nptDate, nptDaysBetween, nptToday } from '../../core/nepal-time';
import { UI_STYLES } from '../../core/ui-styles';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CLOSED = ['cancelled', 'canceled', 'closed', 'awarded', 'lost', 'submitted', 'withdrawn', 'not_bidding'];

/** Bid deadlines by month, BS and AD side by side, with countdowns (Task 15). Nepal Time throughout. */
@Component({
  selector: 'app-bid-calendar',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>📅 Bid Deadline Calendar</h1>
    <p class="sub">Every tender's bid submission deadline. Dates in Nepal Time; BS date in each box.</p>

    <div class="panel">
      <h2>Coming up</h2>
      @if (upcoming().length) {
        <div class="up">
          @for (t of upcoming(); track t.id) {
            <a class="u" [routerLink]="['/tenders', t.id]" [class.bad]="t.days <= 2" [class.warn]="t.days > 2 && t.days <= 7">
              <div class="cd">{{ t.days === 0 ? 'Today' : t.days === 1 ? 'Tomorrow' : t.days + ' days' }}</div>
              <div class="t">{{ t.ifbNumber }}</div>
              <div class="p">{{ t.projectTitle }}</div>
              <div class="d">{{ t.ad }} · {{ t.bs }} BS</div>
            </a>
          }
        </div>
      } @else { <p class="help">No open tenders with a deadline ahead.</p> }
    </div>

    <div class="panel">
      <div class="bar tight">
        <button class="btn light small" (click)="shift(-1)">◀</button>
        <h2 class="mt">{{ monthTitle() }}</h2>
        <button class="btn light small" (click)="shift(1)">▶</button>
        <button class="btn light small" (click)="goToday()">This month</button>
      </div>
      <div class="cal">
        @for (h of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; track h) { <div class="h">{{ h }}</div> }
        @for (c of cells(); track $index) {
          <div class="c" [class.out]="!c.inMonth" [class.today]="c.ad === today" [class.sat]="c.dow === 6">
            <div class="n"><span>{{ c.day }}</span><small>{{ c.bsDay }}</small></div>
            @for (t of c.tenders; track t.id) {
              <a class="ev" [routerLink]="['/tenders', t.id]" [class.closed]="t.closed" [title]="t.projectTitle">{{ t.ifbNumber }}</a>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [UI_STYLES, `
    .up { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
    .u { display: block; border: 1px solid #e1e3e6; border-left: 5px solid #9ca3af; border-radius: 10px; padding: 12px; text-decoration: none; color: inherit; }
    .u.warn { border-left-color: #f0b429; } .u.bad { border-left-color: #dc2626; }
    .u .cd { font-size: 20px; font-weight: 800; color: #0a1f3d; }
    .u .t { font-weight: 700; font-size: 13px; margin-top: 4px; }
    .u .p { font-size: 13px; color: #4b5563; } .u .d { font-size: 12px; color: #9ca3af; margin-top: 4px; }
    .mt { margin: 0 8px; flex: 1; }
    .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 12px; }
    .h { font-size: 12px; font-weight: 700; color: #6b7280; text-align: center; padding: 4px 0; }
    .c { min-height: 92px; border: 1px solid #eef0f2; border-radius: 8px; padding: 4px 6px; background: #fff; overflow: hidden; }
    .c.out { background: #f8f9fa; opacity: .55; } .c.sat { background: #fff8f8; } .c.today { border: 2px solid #d4a017; }
    .n { display: flex; justify-content: space-between; font-weight: 700; color: #0a1f3d; font-size: 13px; }
    .n small { color: #a16a00; font-weight: 600; }
    .ev { display: block; margin-top: 3px; font-size: 11px; background: #0a1f3d; color: #fff; border-radius: 5px; padding: 2px 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
    .ev.closed { background: #9ca3af; }
    @media (max-width: 700px) { .c { min-height: 64px; } .ev { font-size: 10px; } }
  `],
})
export class BidCalendarPage {
  private data = inject(DataService);
  today = nptToday();
  tenders = signal<any[]>([]);
  month = signal(this.today.slice(0, 7)); // 'YYYY-MM'

  constructor() { this.data.getTenders().subscribe({ next: (l) => this.tenders.set(l ?? []), error: () => this.tenders.set([]) }); }

  private rows = computed(() => this.tenders().filter((t) => t.deadlineDate).map((t) => {
    const ad = nptDate(t.deadlineDate);
    return { ...t, ad, bs: adToBs(ad), days: nptDaysBetween(this.today, ad), closed: CLOSED.includes(String(t.status ?? '').toLowerCase()) };
  }));
  upcoming = computed(() => this.rows().filter((t) => !t.closed && t.days >= 0).sort((a, b) => a.days - b.days).slice(0, 12));

  monthTitle() {
    const [y, m] = this.month().split('-').map(Number);
    const first = `${this.month()}-01`, last = addNptDays(`${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
    const bs1 = adToBs(first), bs2 = adToBs(last);
    return `${MONTHS[m - 1]} ${y} · BS ${bs1.slice(0, 7)} – ${bs2.slice(0, 7)}`;
  }
  shift(k: number) {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    this.month.set(d.toISOString().slice(0, 7));
  }
  goToday() { this.month.set(this.today.slice(0, 7)); }

  cells = computed(() => {
    const first = `${this.month()}-01`;
    const dow = new Date(first + 'T00:00:00Z').getUTCDay();
    const start = addNptDays(first, -dow);
    const byDay = new Map<string, any[]>();
    for (const t of this.rows()) byDay.set(t.ad, [...(byDay.get(t.ad) ?? []), t]);
    return Array.from({ length: 42 }, (_, i) => {
      const ad = addNptDays(start, i);
      return { ad, day: Number(ad.slice(8)), bsDay: Number(adToBs(ad).slice(8)) || '', inMonth: ad.slice(0, 7) === this.month(), dow: i % 7, tenders: byDay.get(ad) ?? [] };
    });
  });
}
