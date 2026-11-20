import { Component, computed, inject, signal } from '@angular/core';
import { AccessService } from '../../core/access.service';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { nptToday } from '../../core/nepal-time';

const RATE_KEY = 'pn.fuel.rate';
const VEH_KEY = 'pn.fuel.vehicle';

/** Phone-friendly fuel entry for drivers on site (Task 15) — same data and checks as the Daily Fuel Log. */
@Component({
  selector: 'app-fuel-entry',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <h1>⛽ Fuel entry</h1>
      @if (result(); as r) {
        <div class="result" [class.ok]="r.ok">
          <div class="big">{{ r.ok ? '✅ Saved' : '⚠️ Saved — please check' }}</div>
          <div>{{ r.text }}</div>
          @if (r.use && !limited()) { <div class="use">Fuel use since last full tank: <strong>{{ r.use }}</strong></div> }
          <button class="btn big gold" type="button" (click)="again()">+ Next entry</button>
        </div>
      } @else {
        <form (ngSubmit)="save()">
          <label>Vehicle</label>
          <select name="v" [(ngModel)]="vehicle" required>
            <option value="">— choose —</option>
            @for (v of vehicles(); track v.id) { <option [value]="v.id">{{ v.label }}</option> }
          </select>
          <label>Date</label>
          <input name="d" type="date" [(ngModel)]="date" [max]="today" />
          <label>Meter reading ({{ meterUnit() }})</label>
          <input name="m" type="number" inputmode="decimal" [(ngModel)]="meter" placeholder="e.g. 41790" />
          @if (lastMeter()) { <div class="hint">Last fill: {{ lastMeter() }}</div> }
          @if (limited()) {
            <label>Litres</label><input name="l" type="number" inputmode="decimal" [(ngModel)]="litres" />
          } @else {
            <div class="two">
              <div><label>Litres</label><input name="l" type="number" inputmode="decimal" [(ngModel)]="litres" /></div>
              <div><label>Rate / litre (Rs)</label><input name="r" type="number" inputmode="decimal" [(ngModel)]="rate" /></div>
            </div>
            @if (litres && rate) { <div class="hint">Amount: Rs {{ (litres * rate).toLocaleString('en-IN') }}</div> }
          }
          <label class="tick"><input name="f" type="checkbox" [(ngModel)]="fullTank" /> Filled to full tank</label>
          <label>Bill / coupon no.</label>
          <input name="b" [(ngModel)]="billNo" />
          <label>Fuel station</label>
          <input name="s" [(ngModel)]="station" />
          @if (error()) { <div class="err">{{ error() }}</div> }
          <button class="btn big gold" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save fuel entry' }}</button>
        </form>
      }
      <p class="foot"><a routerLink="/m/fleet.fuel">Open the full Daily Fuel Log →</a></p>
    </div>
  `,
  styles: [`
    .wrap { max-width: 460px; margin: 0 auto; }
    h1 { color: #0a1f3d; margin: 0 0 12px; }
    label { display: block; font-weight: 700; font-size: 15px; color: #0a1f3d; margin: 14px 0 6px; }
    input, select { width: 100%; box-sizing: border-box; font-size: 18px; padding: 12px; border: 1px solid #cfd5dc; border-radius: 10px; background: #fff; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .tick { display: flex; gap: 10px; align-items: center; font-size: 17px; margin-top: 18px; }
    .tick input { width: 24px; height: 24px; }
    .hint { color: #6b7280; font-size: 14px; margin-top: 4px; }
    .btn.big { width: 100%; font-size: 19px; padding: 16px; margin-top: 22px; border: 0; border-radius: 12px; font-weight: 800; cursor: pointer; }
    .btn.gold { background: #d4a017; color: #0a1f3d; }
    .btn:disabled { opacity: .6; }
    .err { background: #fef2f2; color: #b91c1c; padding: 10px 12px; border-radius: 10px; margin-top: 12px; }
    .result { background: #fff7e6; border: 2px solid #f0b429; border-radius: 14px; padding: 18px; font-size: 16px; }
    .result.ok { background: #ecfdf5; border-color: #34d399; }
    .result .big { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
    .use { margin-top: 8px; }
    .foot { text-align: center; margin-top: 22px; }
    .foot a { color: #a16a00; font-weight: 700; }
  `],
})
export class FuelEntryPage {
  private data = inject(DataService);
  private access = inject(AccessService);
  /** few-pages staff (e.g. drivers): no rates and no fuel analysis — the office checks the entries */
  limited = computed(() => !!this.access.info()?.limitedView);
  today = nptToday();
  vehicles = signal<any[]>([]);
  fills = signal<any[]>([]);
  vehicle = this.read(VEH_KEY);
  date = this.today;
  meter: number | null = null;
  litres: number | null = null;
  rate: number | null = Number(this.read(RATE_KEY)) || null;
  fullTank = true;
  billNo = '';
  station = '';
  busy = signal(false);
  error = signal('');
  result = signal<{ ok: boolean; text: string; use: string } | null>(null);

  constructor() {
    this.access.load();
    firstValueFrom(this.data.erpOptions('fleet.vehicle')).then((l) => this.vehicles.set(l)).catch((e) => this.error.set(errorText(e)));
    this.loadFills();
  }
  private read(k: string) { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } }
  private write(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* blocked */ } }
  private loadFills() { firstValueFrom(this.data.erpList('fleet.fuel')).then((l) => this.fills.set(l)).catch(() => {}); }

  meterUnit() { return this.vehicles().find((v) => v.id === this.vehicle)?.extra?.meterType === 'HOURS' ? 'hours' : 'km'; }
  lastMeter() {
    const mine = this.fills().filter((f) => f.data?.vehicle === this.vehicle && f.data?.meter != null)
      .sort((a, b) => String(b.data.date).localeCompare(a.data.date) || b.data.meter - a.data.meter);
    return mine[0] ? `${mine[0].data.meter} on ${mine[0].data.date}` : '';
  }

  async save() {
    this.error.set('');
    if (!this.vehicle) return this.error.set('Choose the vehicle.');
    if (!(Number(this.meter) >= 0) || this.meter === null) return this.error.set('Enter the meter reading.');
    if (!(Number(this.litres) > 0)) return this.error.set('Enter the litres.');
    this.busy.set(true);
    try {
      const data: any = { date: this.date, vehicle: this.vehicle, meter: Number(this.meter), litres: Number(this.litres), fullTank: this.fullTank };
      if (this.rate && !this.limited()) data.rate = Number(this.rate);
      if (this.billNo.trim()) data.billNo = this.billNo.trim();
      if (this.station.trim()) data.station = this.station.trim();
      const r = await firstValueFrom(this.data.erpCreate('fleet.fuel', { data }));
      this.write(VEH_KEY, this.vehicle);
      if (this.rate && !this.limited()) this.write(RATE_KEY, String(this.rate));
      if (this.limited()) {
        this.result.set({ ok: true, text: 'Thank you — the office will check it.', use: '' });
      } else {
        const check = String(r?.data?.check ?? 'OK');
        this.result.set({ ok: check === 'OK', text: check === 'OK' ? 'Everything looks normal.' : check, use: r?.data?.consumption ?? '' });
      }
      this.loadFills();
    } catch (e) { this.error.set(errorText(e)); }
    this.busy.set(false);
  }

  again() {
    this.result.set(null);
    this.meter = null; this.litres = null; this.billNo = ''; this.fullTank = true; this.date = this.today;
  }
}
