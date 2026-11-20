import { describe, expect, it } from 'vitest';
import { extractRequirements, moneyAmounts, npr, pdfReadNote } from './pdf-requirements';
import { parseTenderText } from './pdf-parse';
import { PHEME_KHOLA_TEXT } from './pheme-khola-text.fixture';

const byKind = (text: string) => {
  const rows = extractRequirements(text);
  return (k: string) => rows.filter((r) => r.kind === k);
};

describe('moneyAmounts', () => {
  it('reads million / crore / lakh and plain rupee amounts', () => {
    expect(moneyAmounts('NRs 85.50 million').map((a) => a.amount)).toEqual([85500000]);
    expect(moneyAmounts('a minimum of NRs 4 Million, which').map((a) => a.amount)).toEqual([4000000]);
    expect(moneyAmounts('amounting to a minimum of 4 million').map((a) => a.amount)).toEqual([4000000]);
    expect(moneyAmounts('Rs. 5,52,50,000.00 only').map((a) => a.amount)).toEqual([55250000]);
    expect(moneyAmounts('NRs 6.3 crore').map((a) => a.amount)).toEqual([63000000]);
    expect(moneyAmounts('Rs 45 lakhs').map((a) => a.amount)).toEqual([4500000]);
  });
  it('joins a unit that an EQC table pushed a few cells away', () => {
    expect(moneyAmounts('more than the NRs. 130.00 Form FIN of the of the million - 5').map((a) => a.amount)).toEqual([130000000]);
  });
  it('ignores clause numbers, form numbers and small bare numbers', () => {
    expect(moneyAmounts('ITB 19.1 Form FIN - 4 page 40 2.3.2 hours 13')).toEqual([]);
    expect(moneyAmounts('Rs 3,000 per set')).toEqual([]);
  });
  it('formats in lakh/crore grouping', () => {
    expect(npr(85500000)).toBe('Rs 8,55,00,000');
    expect(npr(4000000)).toBe('Rs 40,00,000');
    expect(npr(1234.5)).toBe('Rs 1,234.50');
  });
});

describe('extractRequirements — real Pheme Khola bridge document (IFB + BDS + EQC + Section VI)', () => {
  const k = byKind(PHEME_KHOLA_TEXT);

  it('turnover: NRs 85.50 million, best 3 of the last 10 years, IFB and EQC agree', () => {
    const [t] = k('TURNOVER');
    expect(t.data).toEqual({ amountNPR: 85500000, bestYears: 3, lookbackYears: 10 });
    expect(t.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('similar contract: one contract of 85.50 million in the last 10 years, each JV partner 14.20 million', () => {
    const [s] = k('SIMILAR_CONTRACT');
    expect(s.data).toMatchObject({ amountNPR: 85500000, count: 1, lookbackYears: 10, partnerAmountNPR: 14200000 });
    expect(s.data['description']).toBe('Construction of at least One Prestressed RCC Bridge');
  });

  it('key activities with quantities per year', () => {
    expect(k('KEY_ACTIVITY').map((r) => r.data)).toEqual([
      { name: 'Reinforcement Works', quantity: 79, unit: 'MT', period: 'year' },
      { name: 'Concrete works of grade M-35 or Above', quantity: 535.74, unit: 'm3', period: 'year' },
    ]);
  });

  it('general experience, cash flow and bid capacity (unit split across table cells)', () => {
    expect(k('GENERAL_EXPERIENCE')[0].data).toEqual({ years: 5 });
    expect(k('FINANCIAL_RESOURCES')[0].data).toEqual({ amountNPR: 23700000 });
    expect(k('BID_CAPACITY')[0].data).toEqual({ amountNPR: 130000000 });
  });

  it('bid security 4 million valid 30 days beyond; validity 90 days; price adjustment applies', () => {
    expect(k('BID_SECURITY')[0].data).toEqual({ amountNPR: 4000000, validBeyondDays: 30 });
    expect(k('BID_VALIDITY')[0].data).toEqual({ days: 90 });
    expect(k('PRICE_ADJUSTMENT')[0].data).toEqual({ applies: true });
  });

  it('reports the blank personnel and equipment tables honestly', () => {
    expect(k('PERSONNEL')[0].data).toEqual({ rows: [], blank: true });
    expect(k('EQUIPMENT')[0].data).toEqual({ rows: [], blank: true });
    expect(k('PERSONNEL')[0].label).toMatch(/left blank/);
  });

  it('does not invent a completion period that is not in these pages', () => {
    expect(k('COMPLETION_PERIOD')).toEqual([]);
  });
});

describe('extractRequirements — other common wordings', () => {
  const other = [
    'Invitation for Bids',
    'Contract Identification No: DOR/ICB/2083-84/07',
    '2.3.2 Average Annual Construction Turnover',
    'Minimum average annual construction turnover of NRs 6.25 crore calculated as total certified payments received for contracts in progress or completed within the best two (2) years of the last five (5) fiscal years.',
    '2.3.4 Required Bid Capacity',
    'The bid capacity shall be equal to or more than NRs. 12,50,00,000.00',
    '2.4.2 Specific Construction Experience',
    '(a) Contracts of Similar Size and Nature',
    'Participation in at least two (2) contracts within the last seven (7) years each with a value of at least NRs 3.5 crore',
    '(b) Construction Experience in Key Activities',
    'Asphalt Concrete 2,400 cubic meters per year',
    'Excavation in soil 15,000 cum per year',
    'GCC 1.1 (r) The Intended Completion Date for the whole of the Works shall be 24 (Twenty Four) months from the date of contract agreement.',
    'ITB 14.6 The prices quoted by the Bidder "shall not be" subject to adjustment during the performance of the Contract.',
    'ITB 18.1 The bid validity period shall be one hundred twenty (120) days.',
    'ITB 19.1 The Bidder shall furnish a bid security of NRs 25,00,000.00 valid for 30 days beyond the bid validity.',
    'Personnel Requirements',
    'SN. Position Required No. Academic Qualification',
    '1. Project Manager 1 BE Civil 10',
    '2. Site Engineer 2 BE Civil 5',
    'Page | 81',
  ].join('\n');
  const k = byKind(other);

  it('crore amounts, "best two of the last five", count words, lakh-grouped rupees', () => {
    expect(k('TURNOVER')[0].data).toEqual({ amountNPR: 62500000, bestYears: 2, lookbackYears: 5 });
    expect(k('BID_CAPACITY')[0].data).toEqual({ amountNPR: 125000000 });
    expect(k('SIMILAR_CONTRACT')[0].data).toMatchObject({ amountNPR: 35000000, count: 2, lookbackYears: 7 });
  });

  it('key activities in cum / cubic meters', () => {
    expect(k('KEY_ACTIVITY').map((r) => [r.data['name'], r.data['quantity'], r.data['unit']])).toEqual([
      ['Asphalt Concrete', 2400, 'm3'],
      ['Excavation in soil', 15000, 'm3'],
    ]);
  });

  it('completion period, fixed prices, 120-day validity, bid security', () => {
    expect(k('COMPLETION_PERIOD')[0].data).toEqual({ value: 24, unit: 'month', months: 24 });
    expect(k('PRICE_ADJUSTMENT')[0].data).toEqual({ applies: false });
    expect(k('BID_VALIDITY')[0].data).toEqual({ days: 120 });
    expect(k('BID_SECURITY')[0].data).toEqual({ amountNPR: 2500000, validBeyondDays: 30 });
  });

  it('reads filled-in personnel rows', () => {
    const [p] = k('PERSONNEL');
    expect(p.data['blank']).toBe(false);
    expect(p.data['rows'].map((r: any) => [r.name, r.count])).toEqual([['Project Manager', 1], ['Site Engineer', 2]]);
  });

  it('lowers confidence when the document gives two different amounts', () => {
    const [t] = extractRequirements('Average Annual Construction Turnover: NRs 10 million\n\nAverage Annual Construction Turnover: NRs 12 million')
      .filter((r) => r.kind === 'TURNOVER');
    expect(t.confidence).toBeLessThan(0.6);
    expect(t.note).toMatch(/different values/);
  });

  it('finds nothing in text that has no requirements', () => {
    expect(extractRequirements('Hello world\nThis is a letter.')).toEqual([]);
  });
});

describe('parseTenderText fills gaps from the requirements reader', () => {
  it('takes bid capacity, period and key activities from Section III / SCC when the IFB has none', () => {
    const text = [
      'Invitation for Bids',
      'Average annual construction turnover as specified in Section III.',
      '2.3.2 Average Annual Construction Turnover',
      'Minimum average annual construction turnover of NRs 6.25 crore within best three years out of last ten fiscal years.',
      '2.3.4 Required Bid Capacity',
      'The bid capacity shall be equal to or more than NRs. 12,50,00,000.00',
      '(b) Construction Experience in Key Activities',
      'Asphalt Concrete 2,400 cubic meters per year',
      'GCC 1.1 (r) The Intended Completion Date for the whole of the Works shall be 18 months from the date of contract agreement.',
    ].join('\n');
    const r = parseTenderText(text);
    expect(r.fields['reqTurnover'].value).toBe(62500000);
    expect(r.fields['reqBidCapacity'].value).toBe(125000000);
    expect(r.fields['contractPeriodMonths'].value).toBe(18);
    expect(r.activities.map((a) => [a.name, a.quantity, a.unit])).toEqual([['Asphalt Concrete', 2400, 'm3']]);
  });
});

describe('pdfReadNote', () => {
  it('says which pages had no text and when a PDF was cut short', () => {
    expect(pdfReadNote({ pages: 10, pagesRead: 10, emptyPages: [] })).toBe('');
    expect(pdfReadNote({ pages: 10, pagesRead: 10, emptyPages: [2, 3] })).toMatch(/2 of 10 pages have no readable text.*page 2, 3/);
    expect(pdfReadNote({ pages: 700, pagesRead: 600, emptyPages: [] })).toMatch(/first 600 of 700/);
  });
});
