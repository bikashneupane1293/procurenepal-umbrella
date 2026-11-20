// Daily Fuel Log — discrepancy checks (Vehicle & Fleet). Pure functions, unit-tested.
// Consumption is measured "full tank to full tank": the litres put in since the last full
// fill, against the km (vehicles) or hours (machines) run since that fill.
// © Cuidado Technology Pvt. Ltd.

export interface FuelFill { id: string; date: string; meter: number | null; litres: number; rate: number | null; fullTank: boolean }
export interface FuelVehicle { meterType?: string; tankCapacity?: number | null; expected?: number | null; tolerancePct?: number | null }
export interface FuelResult {
  id: string;
  /** km or hours since the previous full-tank fill (null when it can't be measured) */
  used: number | null;
  /** litres put in over that stretch */
  litres: number | null;
  /** km per litre (KM meters) or litres per hour (HOURS meters) */
  consumption: number | null;
  flags: string[];
  tone: '' | 'warn' | 'bad';
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const n = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

export const isHours = (v: FuelVehicle) => String(v.meterType ?? 'KM').toUpperCase() === 'HOURS';
export const consumptionUnit = (v: FuelVehicle) => (isHours(v) ? 'litres / hour' : 'km / litre');

/** Order fills the way they happened: by date, then meter reading. */
export function orderFills(fills: FuelFill[]): FuelFill[] {
  return [...fills].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (n(a.meter) ?? 0) - (n(b.meter) ?? 0));
}

export function checkFills(vehicle: FuelVehicle, fills: FuelFill[]): Map<string, FuelResult> {
  const out = new Map<string, FuelResult>();
  const list = orderFills(fills);
  const hours = isHours(vehicle);
  const tank = n(vehicle.tankCapacity);
  const expected = n(vehicle.expected);
  const tol = (n(vehicle.tolerancePct) ?? 15) / 100;

  list.forEach((f, i) => {
    const flags: string[] = [];
    let bad = false;
    const meter = n(f.meter);
    const litres = Number(f.litres) || 0;
    const earlier = list.slice(0, i);
    const prevWithMeter = [...earlier].reverse().find((x) => n(x.meter) != null);

    if (tank && litres > tank * 1.02) { flags.push(`${r2(litres)} l is more than the tank holds (${tank} l)`); bad = true; }
    if (meter != null && prevWithMeter) {
      const pm = n(prevWithMeter.meter)!;
      if (meter < pm) { flags.push(`Meter ${meter} is lower than at the previous fill (${pm} on ${prevWithMeter.date})`); bad = true; }
      else if (meter === pm) flags.push('Meter did not move since the previous fill');
    }
    if (earlier.some((x) => x.date === f.date)) flags.push('Second fill on the same day');
    const prevRate = [...earlier].reverse().find((x) => n(x.rate))?.rate;
    if (n(f.rate) && prevRate && Math.abs(Number(f.rate) - prevRate) / prevRate > 0.1) {
      flags.push(`Rate NPR ${f.rate} is ${Math.round((100 * Math.abs(Number(f.rate) - prevRate)) / prevRate)}% different from the previous fill (NPR ${prevRate})`);
    }

    // full tank → full tank consumption
    let used: number | null = null, sumLitres: number | null = null, consumption: number | null = null;
    if (f.fullTank && meter != null) {
      const lastFullIdx = earlier.map((x, k) => (x.fullTank && n(x.meter) != null ? k : -1)).filter((k) => k >= 0).pop();
      if (lastFullIdx != null) {
        const base = n(earlier[lastFullIdx].meter)!;
        const between = list.slice(lastFullIdx + 1, i + 1);
        sumLitres = r2(between.reduce((s, x) => s + (Number(x.litres) || 0), 0));
        used = r2(meter - base);
        if (used > 0 && sumLitres > 0) {
          consumption = hours ? r2(sumLitres / used) : r2(used / sumLitres);
          if (expected) {
            const pct = Math.round((100 * Math.abs(consumption - expected)) / expected);
            if (!hours && consumption < expected * (1 - tol)) { flags.push(`Only ${consumption} km per litre — expected ${expected} (${pct}% worse)`); bad = true; }
            if (hours && consumption > expected * (1 + tol)) { flags.push(`${consumption} litres per hour — expected ${expected} (${pct}% more)`); bad = true; }
            // far better than expected usually means a fill was not entered, or a meter typo
            if (!hours && consumption > expected * (1 + 2 * tol)) flags.push(`${consumption} km per litre is much better than expected (${expected}) — a fill may be missing or the meter mistyped`);
            if (hours && consumption < expected * (1 - 2 * tol)) flags.push(`${consumption} litres per hour is much lower than expected (${expected}) — a fill may be missing or the meter mistyped`);
          }
        }
      }
    }
    out.set(f.id, { id: f.id, used, litres: sumLitres, consumption, flags, tone: bad ? 'bad' : flags.length ? 'warn' : '' });
  });
  return out;
}
