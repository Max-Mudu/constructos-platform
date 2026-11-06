/**
 * Regression: forms put 422 `details` into per-field state but rendered only
 * some fields inline, so an error on any other field (notes > 2000 chars,
 * quantity 0, a null acceptanceStatus, ...) produced no message at all — the
 * save button just re-enabled. Attendance/target forms showed only the bare
 * "Validation failed".
 */
import { ApiError } from '@/lib/api';
import { currencyOptions, formErrorState, humanizeField } from '@/lib/workflows-form-errors';
import { acceptanceDisplay, acceptancePatch } from '@/lib/workflows-delivery';

const validation = (details: Record<string, string[]>) =>
  new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', details);

describe('formErrorState', () => {
  it('keeps inline fields inline and leaves the banner empty when all are shown', () => {
    const s = formErrorState(validation({ supplierName: ['Required'] }), ['supplierName'], 'x');
    expect(s.fieldErrors).toEqual({ supplierName: ['Required'] });
    expect(s.message).toBe('');
  });

  it('lists every field the form does not render in the banner', () => {
    const s = formErrorState(
      validation({
        supplierName: ['Required'],
        quantityOrdered: ['Number must be greater than 0'],
        notes: ['String must contain at most 2000 character(s)'],
      }),
      ['supplierName', 'deliveryDate', 'itemDescription'],
      'Failed to save delivery record',
    );
    expect(s.fieldErrors).toEqual({ supplierName: ['Required'] });
    expect(s.message).toContain('Quantity ordered: Number must be greater than 0');
    expect(s.message).toContain('Notes: String must contain at most 2000 character(s)');
    expect(s.message).not.toContain('Supplier name');
  });

  it('surfaces the delivery-edit null acceptanceStatus rejection (previously silent)', () => {
    const s = formErrorState(
      validation({ acceptanceStatus: ["Expected 'accepted' | 'partially_accepted' | 'rejected', received null"] }),
      ['supplierName', 'itemDescription'],
      'Failed to update delivery record',
    );
    expect(s.message).toMatch(/^Please fix the following — Acceptance status: /);
  });

  it('with no inline fields (attendance/targets forms) names each field instead of "Validation failed"', () => {
    const s = formErrorState(validation({ targetValue: ['Number must be greater than 0'] }), [], 'Failed to create target');
    expect(s.message).toBe('Please fix the following — Target value: Number must be greater than 0');
    expect(s.message).not.toBe('Validation failed');
  });

  it('uses custom labels when given', () => {
    const s = formErrorState(validation({ workerId: ['Invalid uuid'] }), [], 'x', { workerId: 'Worker' });
    expect(s.message).toContain('Worker: Invalid uuid');
  });

  it('ignores empty detail arrays and falls back to the API message', () => {
    const s = formErrorState(validation({ notes: [] }), ['notes'], 'fallback');
    expect(s).toEqual({ fieldErrors: {}, message: 'Validation failed' });
  });

  it('shows the API message for non-validation errors (403, 404, 409)', () => {
    const s = formErrorState(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions'), ['a'], 'fallback');
    expect(s).toEqual({ fieldErrors: {}, message: 'Insufficient permissions' });
  });

  it('uses the fallback for non-API errors (network TypeError)', () => {
    const s = formErrorState(new TypeError('Failed to fetch'), ['a'], 'Something went wrong');
    expect(s).toEqual({ fieldErrors: {}, message: 'Something went wrong' });
  });
});

describe('humanizeField', () => {
  it.each([
    ['quantityOrdered', 'Quantity ordered'],
    ['emergencyContactPhone', 'Emergency contact phone'],
    ['work_package_id', 'Work package id'],
    ['notes', 'Notes'],
    ['', 'Form'],
  ])('%p → %p', (input, expected) => expect(humanizeField(input)).toBe(expected));
});

describe('currencyOptions (worker edit form)', () => {
  it('offers the same 8 currencies as the New Worker form', () => {
    expect(currencyOptions('KES')).toEqual(['USD', 'EUR', 'GBP', 'ZAR', 'AED', 'NGN', 'KES', 'GHS']);
  });

  it.each(['ZAR', 'AED', 'NGN', 'GHS'])('includes %s (previously missing, displayed as KES)', (c) => {
    expect(currencyOptions(c)).toContain(c);
  });

  it('keeps an unlisted stored code so the form shows the truth', () => {
    expect(currencyOptions('TZS')[0]).toBe('TZS');
  });

  it('does not inject junk values', () => {
    expect(currencyOptions('<b>')).not.toContain('<b>');
    expect(currencyOptions(null)).toHaveLength(8);
  });
});

describe('delivery acceptance status', () => {
  it('shows a null status as "Not recorded", not as Rejected', () => {
    expect(acceptanceDisplay(null)).toEqual({ label: 'Not recorded', variant: 'outline' });
    expect(acceptanceDisplay(undefined).label).toBe('Not recorded');
    expect(acceptanceDisplay('rejected')).toEqual({ label: 'Rejected', variant: 'destructive' });
    expect(acceptanceDisplay('accepted').variant).toBe('active');
  });

  it('omits an unset status from the PATCH body (the API rejects null)', () => {
    expect(acceptancePatch('')).toEqual({});
    expect(acceptancePatch(null)).toEqual({});
    expect(acceptancePatch('bogus')).toEqual({});
    expect(acceptancePatch('partially_accepted')).toEqual({ acceptanceStatus: 'partially_accepted' });
  });
});
