import * as fs from 'fs';
import * as path from 'path';
import { entryWage, formatLabourCost, formatMonthLabourCost, labourCostByCurrency } from '@/lib/workflows-labour';

// The same data as packages/api/tests/labour-cost-consistency.test.ts: the
// register's figures must equal the API's dashboard / report figures.
//   6.5 h x 1800 USD, 4 h x 1200 USD, 10 h x 2000 USD, 7.25 h x 3000 KES
const ENTRIES = [
  { hoursWorked: '6.50',  dailyRate: '1800.00', currency: 'USD' },
  { hoursWorked: '4.00',  dailyRate: '1200.00', currency: 'USD' },
  { hoursWorked: '10.00', dailyRate: '2000.00', currency: 'USD' },
  { hoursWorked: '7.25',  dailyRate: '3000.00', currency: 'KES' },
];

describe('labour register uses hours / 8 x daily rate', () => {
  it('fractional, partial and long days, several workers and rates', () => {
    expect(ENTRIES.map(entryWage)).toEqual([1462.5, 600, 2500, 2718.75]);
    expect(labourCostByCurrency(ENTRIES)).toEqual([
      { currency: 'USD', total: 4562.5 },
      { currency: 'KES', total: 2718.75 },
    ]);
  });

  it('the register total never adds currencies', () => {
    expect(formatLabourCost(labourCostByCurrency(ENTRIES)))
      .toBe(`${(4563).toLocaleString()} USD + ${(2719).toLocaleString()} KES`);
  });
});

describe('formatMonthLabourCost (dashboard Month Cost)', () => {
  const fmt = (v: number, c: string) => `${c} ${v}`;

  it('shows one figure per currency from the API', () => {
    expect(formatMonthLabourCost({
      thisMonthCost: 4562.5,
      thisMonthCostByCurrency: [{ currency: 'KES', total: 2718.75 }, { currency: 'USD', total: 4562.5 }],
    }, 'USD', fmt)).toBe('KES 2718.75 + USD 4562.5');
  });

  it('a single currency shows that currency, not the company one', () => {
    expect(formatMonthLabourCost({
      thisMonthCost: 0,
      thisMonthCostByCurrency: [{ currency: 'KES', total: 1350 }],
    }, 'USD', fmt)).toBe('KES 1350');
  });

  it('no entries, or an older API without the list, falls back to thisMonthCost in the company currency', () => {
    expect(formatMonthLabourCost({ thisMonthCost: 0, thisMonthCostByCurrency: [] }, 'USD', fmt)).toBe('USD 0');
    expect(formatMonthLabourCost({ thisMonthCost: 1800 }, 'KES', fmt)).toBe('KES 1800');
  });

  it('withheld (null) for users without finance access', () => {
    expect(formatMonthLabourCost({ thisMonthCost: null, thisMonthCostByCurrency: null }, 'USD', fmt)).toBeNull();
  });
});

describe('every web labour cost display uses the shared rule', () => {
  const APP = path.resolve(__dirname, '..', 'app', '(app)');
  const read = (...p: string[]) => fs.readFileSync(path.join(APP, ...p), 'utf8');
  const labour = ['projects', '[projectId]', 'sites', '[siteId]', 'labour'];

  it('Log Labour estimate uses entryWage, not its own formula', () => {
    const form = read(...labour, 'new', 'page.tsx');
    expect(form).toMatch(/entryWage\(form\)/);
    expect(form).not.toMatch(/\/\s*8\)\s*\*/);
  });

  it('dashboard Month Cost uses formatMonthLabourCost', () => {
    const dash = read('dashboard', 'page.tsx');
    expect(dash).toMatch(/formatMonthLabourCost\(stats\.labour/);
    expect(dash).not.toMatch(/formatMoney\(thisMonthCost/);
  });
});
