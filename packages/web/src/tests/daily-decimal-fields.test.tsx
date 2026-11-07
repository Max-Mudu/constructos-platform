/**
 * Daily Report number fields: quantity, hours lost, progress and temperature
 * (non-integer in the API's content schema) keep decimals up to 2 places;
 * headcounts (integer in the API schema) take whole numbers. Nothing is
 * silently rounded.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { emptyContent, emptyDelay, emptyManpowerEntry, emptyWorkItem, parseNumberInput } from '@/components/daily/content';
import { SectionEditor } from '@/components/daily/editors';

describe('parseNumberInput — decimals', () => {
  it('keeps up to the allowed decimal places', () => {
    expect(parseNumberInput('2.5', { maxDecimals: 2 })).toBe(2.5);
    expect(parseNumberInput('0.75', { maxDecimals: 2 })).toBe(0.75);
    expect(parseNumberInput('1,250.25', { maxDecimals: 2 })).toBe(1250.25);
    expect(parseNumberInput('12,5', { maxDecimals: 2 })).toBe(12.5);
    expect(parseNumberInput('3.50', { maxDecimals: 2 })).toBe(3.5);
    expect(parseNumberInput('3.500', { maxDecimals: 2 })).toBe(3.5); // trailing zeros are not precision
  });

  it('rejects more decimal places than allowed instead of rounding', () => {
    expect(parseNumberInput('1.255', { maxDecimals: 2 })).toBeNull();
    expect(parseNumberInput('1e-3', { maxDecimals: 2 })).toBeNull();
  });

  it('integer fields reject a decimal instead of rounding it', () => {
    expect(parseNumberInput('2.5', { integer: true })).toBeNull();
    expect(parseNumberInput('12', { integer: true })).toBe(12);
  });
});

describe('SectionEditor number fields', () => {
  it('hours lost keeps a decimal value', () => {
    const onChange = jest.fn();
    render(<SectionEditor section="delays" value={[emptyDelay()]} onChange={onChange} flagged={new Set()} />);

    fireEvent.change(screen.getByLabelText('Hours lost'), { target: { value: '1.5' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ hoursLost: 1.5 })]);
    expect(screen.queryByText(/Enter a number/)).not.toBeInTheDocument();
  });

  it('quantity keeps 2 decimal places and flags a third', () => {
    const onChange = jest.fn();
    render(<SectionEditor section="workCompleted" value={[emptyWorkItem()]} onChange={onChange} flagged={new Set()} />);
    const quantity = screen.getByLabelText('Quantity');

    fireEvent.change(quantity, { target: { value: '12.75' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ quantity: 12.75 })]);

    fireEvent.change(quantity, { target: { value: '12.755' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ quantity: null })]);
    expect(screen.getByText('Enter a number with up to 2 decimal places.')).toBeInTheDocument();
  });

  it('headcount takes whole numbers only', () => {
    const onChange = jest.fn();
    const manpower = { ...emptyContent().manpower, entries: [emptyManpowerEntry()] };
    render(<SectionEditor section="manpower" value={manpower} onChange={onChange} flagged={new Set()} />);

    fireEvent.change(screen.getByLabelText('Number of people'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ entries: [expect.objectContaining({ count: null })] }));
    expect(screen.getByText('Enter a whole number.')).toBeInTheDocument();
  });
});
