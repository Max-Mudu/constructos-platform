import * as fs from 'fs';
import * as path from 'path';
import { formatTxQuantity } from '@/lib/workflows-inventory';

describe('formatTxQuantity', () => {
  it('shows usage (stored negative) with a single minus sign', () => {
    expect(formatTxQuantity('usage_out', '-5.000')).toBe('-5');
    expect(formatTxQuantity('usage_out', '-1250.500')).toBe(`-${(1250.5).toLocaleString(undefined, { maximumFractionDigits: 3 })}`);
  });

  it('positive control: the old rendering doubled the sign', () => {
    const old = `-${parseFloat('-5.000').toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
    expect(old).toBe('--5');
  });

  it('takes direction from the type for positive stored values', () => {
    expect(formatTxQuantity('delivery_in', '500.000')).toBe('+500');
    expect(formatTxQuantity('adjustment_out', '2.500')).toBe('-2.5');
    expect(formatTxQuantity('transfer_in', 3)).toBe('+3');
  });

  it('does not print NaN for a non-numeric value', () => {
    expect(formatTxQuantity('delivery_in', 'n/a')).toBe('+n/a');
  });

  it('the site inventory page uses it for transaction quantities', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'app', '(app)', 'projects', '[projectId]', 'sites', '[siteId]', 'inventory', 'page.tsx'), 'utf8');
    expect(src).toMatch(/formatTxQuantity\(tx\.type, tx\.quantity\)/);
    expect(src).not.toMatch(/\{txSign\(tx\.type\)\}\{formatQty\(tx\.quantity\)\}/);
  });
});
