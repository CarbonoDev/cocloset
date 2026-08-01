const { LAUNDRY_STATUSES, isLegalNextLaundryStatus } = require('./laundryStatusHelpers');

describe('LAUNDRY_STATUSES', () => {
  it('is the exact 7-step sequence from design doc §9, in order', () => {
    expect(LAUNDRY_STATUSES).toEqual([
      'ready-for-pickup',
      'picked-up',
      'returned',
      'pending-cleaning',
      'cleaning-in-progress',
      'quality-inspection',
      'available-for-booking',
    ]);
  });
});

describe('isLegalNextLaundryStatus()', () => {
  it('allows setting the first status when none is set yet (null)', () => {
    expect(isLegalNextLaundryStatus(null, 'ready-for-pickup')).toBe(true);
  });

  it('allows setting the first status when none is set yet (undefined)', () => {
    expect(isLegalNextLaundryStatus(undefined, 'ready-for-pickup')).toBe(true);
  });

  it('rejects starting anywhere other than the first status', () => {
    expect(isLegalNextLaundryStatus(null, 'picked-up')).toBe(false);
    expect(isLegalNextLaundryStatus(undefined, 'available-for-booking')).toBe(false);
  });

  it('allows a valid forward step to the immediate next status', () => {
    expect(isLegalNextLaundryStatus('ready-for-pickup', 'picked-up')).toBe(true);
    expect(isLegalNextLaundryStatus('picked-up', 'returned')).toBe(true);
    expect(isLegalNextLaundryStatus('returned', 'pending-cleaning')).toBe(true);
    expect(isLegalNextLaundryStatus('pending-cleaning', 'cleaning-in-progress')).toBe(true);
    expect(isLegalNextLaundryStatus('cleaning-in-progress', 'quality-inspection')).toBe(true);
    expect(isLegalNextLaundryStatus('quality-inspection', 'available-for-booking')).toBe(true);
  });

  it('allows an idempotent retry of the same status', () => {
    LAUNDRY_STATUSES.forEach(status => {
      expect(isLegalNextLaundryStatus(status, status)).toBe(true);
    });
  });

  it('rejects an illegal skip-ahead', () => {
    expect(isLegalNextLaundryStatus('ready-for-pickup', 'cleaning-in-progress')).toBe(false);
    expect(isLegalNextLaundryStatus('picked-up', 'available-for-booking')).toBe(false);
    expect(isLegalNextLaundryStatus(null, 'quality-inspection')).toBe(false);
  });

  it('rejects an illegal backward move', () => {
    expect(isLegalNextLaundryStatus('picked-up', 'ready-for-pickup')).toBe(false);
    expect(isLegalNextLaundryStatus('available-for-booking', 'quality-inspection')).toBe(false);
    expect(isLegalNextLaundryStatus('returned', 'picked-up')).toBe(false);
  });

  it('rejects an unknown status string as the new status', () => {
    expect(isLegalNextLaundryStatus('ready-for-pickup', 'not-a-real-status')).toBe(false);
    expect(isLegalNextLaundryStatus(null, 'bogus')).toBe(false);
    expect(isLegalNextLaundryStatus(null, '')).toBe(false);
  });

  it('rejects when the current status is itself not a recognized value', () => {
    expect(isLegalNextLaundryStatus('some-garbage-value', 'ready-for-pickup')).toBe(false);
  });
});
