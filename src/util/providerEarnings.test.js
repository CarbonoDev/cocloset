import { sumProviderEarnings } from './providerEarnings';

const sale = (transitionNames, payoutTotal) => ({
  id: { uuid: 'tx' },
  attributes: {
    transitions: transitionNames.map(transition => ({ transition })),
    payoutTotal,
  },
});

const usd = amount => ({ amount, currency: 'USD' });

// Payout fires when the studio opens the cleaning ticket, not when the rental is finally marked
// delivered - see the note on PAYOUT_TRANSITIONS. So a garment still in the wash has already
// earned its owner money, and these use that transition on purpose.
const PAID = 'transition/laundry-mark-pending-cleaning';
const ALSO_PAID = 'transition/complete';

describe('sumProviderEarnings', () => {
  it('adds up what the owner was actually paid', () => {
    const result = sumProviderEarnings([
      sale(['transition/accept', PAID], usd(4500)),
      sale(['transition/accept', ALSO_PAID], usd(3000)),
    ]);

    expect(result).toEqual({ amount: 7500, currency: 'USD', count: 2, skippedCount: 0 });
  });

  // The point of asking the transitions rather than the state. A declined, expired or cancelled
  // rental is `isFinal` too, and earned nothing - so "final" is the wrong test however natural
  // it reads.
  it('ignores rentals that never paid out', () => {
    const result = sumProviderEarnings([
      sale(['transition/accept', PAID], usd(4500)),
      sale(['transition/decline'], usd(9999)),
      sale(['transition/expire'], usd(9999)),
      sale(['transition/cancel'], usd(9999)),
      sale(['transition/accept'], usd(9999)),
    ]);

    expect(result.amount).toBe(4500);
    expect(result.count).toBe(1);
  });

  // A rental in progress has not paid anybody.
  it('ignores a rental that is still going on', () => {
    const result = sumProviderEarnings([
      sale(['transition/accept', 'transition/laundry-confirm-pickup'], usd(4500)),
    ]);

    expect(result).toEqual({ amount: 0, currency: null, count: 0, skippedCount: 0 });
  });

  // Money in two currencies cannot be added. Counted and reported rather than silently summed
  // or silently dropped.
  it('refuses to add two currencies, and says how many it left out', () => {
    const result = sumProviderEarnings([
      sale([PAID], usd(4500)),
      sale([PAID], { amount: 9999, currency: 'EUR' }),
    ]);

    expect(result.amount).toBe(4500);
    expect(result.currency).toBe('USD');
    expect(result.count).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('honours a currency it is given rather than guessing from the first row', () => {
    const result = sumProviderEarnings(
      [sale([PAID], usd(4500)), sale([PAID], { amount: 100, currency: 'EUR' })],
      'EUR'
    );

    expect(result).toEqual({ amount: 100, currency: 'EUR', count: 1, skippedCount: 1 });
  });

  // Zero would be a lie that averages into the total; an unusable row is something the caller
  // can report.
  it('treats a paid rental with no payout total as unusable, not as zero', () => {
    const result = sumProviderEarnings([sale([PAID], null), sale([PAID], usd(4500))]);

    expect(result.amount).toBe(4500);
    expect(result.count).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('survives nothing at all', () => {
    [[], null, undefined, 'nope'].forEach(input => {
      expect(sumProviderEarnings(input)).toEqual({
        amount: 0,
        currency: null,
        count: 0,
        skippedCount: 0,
      });
    });
  });
});
