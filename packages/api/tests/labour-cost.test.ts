/**
 * utils/labour-cost: cost = hoursWorked / 8 x dailyRate, exact decimals,
 * grouped per currency (never summed across currencies).
 */
import { Prisma } from '@prisma/client';
import { labourEntryCost, labourCostByCurrency, toCents, HOURS_PER_DAY } from '../src/utils/labour-cost';

describe('labourEntryCost', () => {
  it('a full 8 h day costs the daily rate', () => {
    expect(HOURS_PER_DAY).toBe(8);
    expect(labourEntryCost(8, 1500).toNumber()).toBe(1500);
  });

  it('fractional hours are pro rata', () => {
    expect(labourEntryCost(6.5, 1800).toNumber()).toBe(1462.5);
    expect(labourEntryCost(7.25, 3000).toNumber()).toBe(2718.75);
    expect(labourEntryCost(0.25, 1600).toNumber()).toBe(50);
  });

  it('partial days and hours above a day are pro rata, not capped', () => {
    expect(labourEntryCost(4, 1200).toNumber()).toBe(600);
    expect(labourEntryCost(10, 2000).toNumber()).toBe(2500);
    expect(labourEntryCost(24, 1000).toNumber()).toBe(3000);
  });

  it('zero hours cost nothing', () => {
    expect(labourEntryCost(0, 1500).toNumber()).toBe(0);
  });

  it('accepts Prisma Decimals and strings (as stored / as serialised)', () => {
    expect(labourEntryCost(new Prisma.Decimal('6.50'), new Prisma.Decimal('1800.00')).toString()).toBe('1462.5');
    expect(labourEntryCost('6.5', '1800').toString()).toBe('1462.5');
  });

  it('keeps exact decimals where floats drift', () => {
    // 3 entries of 0.1 h at 0.70/day = 0.02625 exactly; rounds half up to 0.03.
    const t = labourCostByCurrency([
      { hoursWorked: '0.10', dailyRate: '0.70', currency: 'USD' },
      { hoursWorked: '0.10', dailyRate: '0.70', currency: 'USD' },
      { hoursWorked: '0.10', dailyRate: '0.70', currency: 'USD' },
    ]);
    expect(t[0]!.total.toString()).toBe('0.02625');
    expect(toCents(t[0]!.total)).toBe(0.03);
  });
});

describe('labourCostByCurrency', () => {
  it('multiple workers, different rates: one total per currency, sorted by code', () => {
    const totals = labourCostByCurrency([
      { hoursWorked: 6.5,  dailyRate: 1800, currency: 'USD' },
      { hoursWorked: 7.25, dailyRate: 3000, currency: 'KES' },
      { hoursWorked: 4,    dailyRate: 1200, currency: 'USD' },
      { hoursWorked: 10,   dailyRate: 2000, currency: 'USD' },
    ]);
    expect(totals.map((t) => [t.currency, t.total.toNumber()])).toEqual([
      ['KES', 2718.75],
      ['USD', 4562.5],
    ]);
  });

  it('no entries: no totals', () => {
    expect(labourCostByCurrency([])).toEqual([]);
  });
});
