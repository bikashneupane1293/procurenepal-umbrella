import { checkFills, FuelFill } from './fuel-check';

const fill = (id: string, date: string, meter: number | null, litres: number, o: Partial<FuelFill> = {}): FuelFill => ({ id, date, meter, litres, rate: 170, fullTank: true, ...o });

describe('Daily Fuel Log checks', () => {
  const truck = { meterType: 'KM', tankCapacity: 200, expected: 3, tolerancePct: 15 };

  it('measures km per litre full tank to full tank, counting part fills in between', () => {
    const r = checkFills(truck, [fill('a', '2026-11-01', 10000, 150), fill('b', '2026-11-03', 10150, 20, { fullTank: false }), fill('c', '2026-11-05', 10300, 80)]);
    expect(r.get('a')!.consumption).toBeNull();
    expect(r.get('b')!.consumption).toBeNull(); // part fill: not measured on its own
    expect(r.get('c')).toMatchObject({ used: 300, litres: 100, consumption: 3, flags: [], tone: '' });
  });

  it('flags fuel use worse than expected beyond the allowed difference', () => {
    const r = checkFills(truck, [fill('a', '2026-11-01', 10000, 100), fill('b', '2026-11-02', 10200, 100)]);
    expect(r.get('b')!.consumption).toBe(2);
    expect(r.get('b')!.tone).toBe('bad');
    expect(r.get('b')!.flags[0]).toMatch(/Only 2 km per litre — expected 3 \(33% worse\)/);
    // within 15% → fine
    expect(checkFills(truck, [fill('a', '2026-11-01', 10000, 100), fill('b', '2026-11-02', 10270, 100)]).get('b')!.tone).toBe('');
  });

  it('flags over-tank fills, meter going backwards, same-day repeats and rate jumps', () => {
    const r = checkFills(truck, [fill('a', '2026-11-01', 10000, 210), fill('b', '2026-11-02', 9990, 50), fill('c', '2026-11-02', 10100, 30, { rate: 200 })]);
    expect(r.get('a')!.flags).toEqual(['210 l is more than the tank holds (200 l)']);
    expect(r.get('b')!.flags[0]).toMatch(/Meter 9990 is lower than at the previous fill \(10000/);
    expect(r.get('c')!.flags.join(' | ')).toMatch(/Second fill on the same day.*Rate NPR 200 is 18% different/);
  });

  it('machines on an hour meter: litres per hour, more than expected is flagged', () => {
    const exc = { meterType: 'HOURS', expected: 12, tolerancePct: 10 };
    const r = checkFills(exc, [fill('a', '2026-11-01', 500, 150), fill('b', '2026-11-03', 510, 150)]);
    expect(r.get('b')).toMatchObject({ used: 10, consumption: 15, tone: 'bad' });
    expect(r.get('b')!.flags[0]).toMatch(/15 litres per hour — expected 12 \(25% more\)/);
  });

  it('much better than expected = a fill may be missing (warning, not error)', () => {
    const r = checkFills(truck, [fill('a', '2026-11-01', 10000, 50), fill('b', '2026-11-04', 10500, 50)]);
    expect(r.get('b')!.consumption).toBe(10);
    expect(r.get('b')!.tone).toBe('warn');
    expect(r.get('b')!.flags[0]).toMatch(/a fill may be missing/);
  });

  it('entries typed out of order are checked in date order', () => {
    const r = checkFills(truck, [fill('late', '2026-11-05', 10300, 100), fill('early', '2026-11-01', 10000, 100)]);
    expect(r.get('late')!.used).toBe(300);
    expect(r.get('early')!.flags).toEqual([]);
  });
});
