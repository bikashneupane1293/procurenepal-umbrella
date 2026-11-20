import { addNptDays, endOfNptDay, nptDate, nptDaysBetween, nptStamp, nptToday } from './nepal-time';

describe('nepal-time (UTC+05:45)', () => {
  it('uses the Nepal date just after midnight NPT, while UTC is still on the previous day', () => {
    const t = new Date('2026-11-19T18:20:00Z'); // = 2026-11-20 00:05 NPT
    expect(t.toISOString().slice(0, 10)).toBe('2026-11-19'); // what the old UTC code would say
    expect(nptToday(t)).toBe('2026-11-20');
    expect(nptDate(new Date('2026-11-19T18:14:59Z'))).toBe('2026-11-19'); // 23:59:59 NPT
  });
  it('keeps date-only values (stored as UTC midnight) on their own date', () => {
    expect(nptDate(new Date('2026-12-31T00:00:00Z'))).toBe('2026-12-31');
    expect(nptDate('2026-12-31')).toBe('2026-12-31');
  });
  it('end of a Nepal day is 18:14:59.999 UTC', () => {
    expect(endOfNptDay('2026-12-31').toISOString()).toBe('2026-12-31T18:14:59.999Z');
  });
  it('adds days and counts days across month/year ends', () => {
    expect(addNptDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(nptDaysBetween('2026-12-28', '2027-01-04')).toBe(7);
    expect(nptDaysBetween('2027-01-04', '2026-12-28')).toBe(-7);
  });
  it('formats a readable NPT stamp', () => {
    expect(nptStamp(new Date('2026-11-19T19:09:00Z'))).toBe('2026-11-20 00:54 NPT');
  });
});
