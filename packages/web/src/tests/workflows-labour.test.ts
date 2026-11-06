import * as fs from 'fs';
import * as path from 'path';
import { entryWage, formatLabourCost, labourCostByCurrency, rateForWorker } from '@/lib/workflows-labour';

describe('labourCostByCurrency', () => {
  it('keeps currencies apart instead of adding KES to USD', () => {
    const totals = labourCostByCurrency([
      { hoursWorked: '8.00', dailyRate: '1500.00', currency: 'KES' },
      { hoursWorked: '4.00', dailyRate: '40.00',   currency: 'USD' },
      { hoursWorked: '8.00', dailyRate: '1000.00', currency: 'KES' },
    ]);
    expect(totals).toEqual([{ currency: 'KES', total: 2500 }, { currency: 'USD', total: 20 }]);
    expect(formatLabourCost(totals)).toBe(`${(2500).toLocaleString()} KES + 20 USD`);
  });

  it('a single currency reads as before', () => {
    const totals = labourCostByCurrency([{ hoursWorked: '8', dailyRate: '1200', currency: 'KES' }]);
    expect(formatLabourCost(totals)).toBe(`${(1200).toLocaleString()} KES`);
  });

  it('skips entries without a usable rate and shows 0 for nothing', () => {
    expect(labourCostByCurrency([{ hoursWorked: '8', dailyRate: undefined, currency: undefined }])).toEqual([]);
    expect(formatLabourCost([])).toBe('0');
  });

  it('entryWage is hours / 8 x daily rate on Decimal strings', () => {
    expect(entryWage({ hoursWorked: '4.00', dailyRate: '1000.00' })).toBe(500);
  });
});

describe('rateForWorker', () => {
  it("uses the worker's wage", () => {
    expect(rateForWorker('1500.00')).toBe('1500');
    expect(rateForWorker(800)).toBe('800');
  });

  it("is empty for a worker with no wage, never the previous worker's rate", () => {
    expect(rateForWorker(null)).toBe('');
    expect(rateForWorker(undefined)).toBe('');
    expect(rateForWorker('')).toBe('');
    expect(rateForWorker('0.00')).toBe('');
  });
});

describe('labour pages', () => {
  const S = path.resolve(__dirname, '..', 'app', '(app)', 'projects', '[projectId]', 'sites', '[siteId]', 'labour');
  const list = fs.readFileSync(path.join(S, 'page.tsx'), 'utf8');
  const form = fs.readFileSync(path.join(S, 'new', 'page.tsx'), 'utf8');

  it('the list totals cost per currency and formats Decimal hours', () => {
    expect(list).toMatch(/labourCostByCurrency\(entries\)/);
    expect(list).not.toMatch(/entries\[0\]\.currency/);
    expect(list).not.toMatch(/\{e\.hoursWorked\}h/);
  });

  it('the form does not carry a rate over from the previous worker', () => {
    expect(form).not.toMatch(/:\s*f\.dailyRate/);
    expect(form).toMatch(/rateForWorker\(w\?\.dailyWage\)/);
  });
});
