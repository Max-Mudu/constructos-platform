/**
 * Daily report number fields: values are displayed with en-KE grouping
 * ("1,500"), so typing "1,500" must mean one thousand five hundred — it used
 * to be read as the decimal 1.5 and saved without any warning.
 */
import { parseNumberInput } from '@/components/daily/content';

describe('parseNumberInput — thousands separators', () => {
  it('reads comma-grouped thousands as thousands', () => {
    expect(parseNumberInput('1,500')).toBe(1500);
    expect(parseNumberInput('10,000')).toBe(10000);
    expect(parseNumberInput('1,234,567')).toBe(1234567);
    expect(parseNumberInput('12,000.5')).toBe(12000.5);
    expect(parseNumberInput(' 2,500 ')).toBe(2500);
  });

  it('still accepts a decimal comma that is not a thousands group', () => {
    expect(parseNumberInput('12,5')).toBe(12.5);
    expect(parseNumberInput('0,75')).toBe(0.75);
    expect(parseNumberInput(',5')).toBe(0.5);
    expect(parseNumberInput('1,5000')).toBe(1.5);
  });

  it('rejects ambiguous or malformed comma input instead of guessing', () => {
    expect(parseNumberInput('1,2,3')).toBeNull();
    expect(parseNumberInput('1.500,5')).toBeNull();
    expect(parseNumberInput('1,')).toBeNull();
  });

  it('applies the existing options after normalising', () => {
    expect(parseNumberInput('1,500', { max: 1000 })).toBeNull();
    expect(parseNumberInput('-1,500', { allowNegative: true })).toBe(-1500);
    expect(parseNumberInput('-1,500')).toBeNull();
    expect(parseNumberInput('1,500.6', { integer: true })).toBeNull();
    expect(parseNumberInput('1,500', { integer: true })).toBe(1500);
  });

  it('plain numbers are unchanged', () => {
    expect(parseNumberInput('42')).toBe(42);
    expect(parseNumberInput('3.25')).toBe(3.25);
    expect(parseNumberInput('')).toBeNull();
  });
});
