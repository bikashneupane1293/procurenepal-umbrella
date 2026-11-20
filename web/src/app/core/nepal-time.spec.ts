import { nptDate, nptToday } from './nepal-time';

describe('nepal-time (web)', () => {
  it('uses the Nepal date just after midnight NPT', () => {
    expect(nptToday(new Date('2026-11-19T18:20:00Z'))).toBe('2026-11-20');
    expect(nptDate('2026-12-31')).toBe('2026-12-31');
  });
});
