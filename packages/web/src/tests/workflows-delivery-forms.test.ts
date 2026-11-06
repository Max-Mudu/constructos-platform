/**
 * Delivery quantities are Decimal(12,3): the forms must accept fractional
 * values (2.5 m3), and the edit form must be able to save one it pre-fills.
 * An <input type="number"> without a step only accepts whole numbers.
 */
import * as fs from 'fs';
import * as path from 'path';

const D = path.resolve(__dirname, '..', 'app', '(app)', 'projects', '[projectId]', 'sites', '[siteId]', 'deliveries');
const read = (...p: string[]) => fs.readFileSync(path.join(D, ...p), 'utf8');

function numberInputs(src: string): string[] {
  return src.match(/<input[^>]*?type="number"[^>]*>/g) ?? [];
}

describe('delivery quantity inputs accept decimals', () => {
  it.each([
    ['new form', ['new', 'page.tsx']],
    ['edit form', ['[deliveryId]', 'edit', 'page.tsx']],
  ])('%s', (_label, p) => {
    const inputs = numberInputs(read(...(p as string[])));
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const i of inputs) expect(i).toMatch(/step="any"/);
  });

  it('positive control: an input without step is detected', () => {
    const inputs = numberInputs('<input\n  type="number"\n  min={0}\n/>');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).not.toMatch(/step="any"/);
  });
});

describe('delivery detail', () => {
  it('shows discrepancy notes whatever the acceptance decision', () => {
    const src = read('[deliveryId]', 'page.tsx');
    const gate = src.indexOf('{hasDiscrepancy && (');
    const notes = src.indexOf('label="Discrepancy Notes"');
    expect(gate).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(gate);
    // The partially_accepted / rejected-only block closes before the notes row.
    expect(src.slice(gate, notes)).toMatch(/\)\}/);
  });
});
