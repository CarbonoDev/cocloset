import { hasPaidOut } from '../transactions/transactionProcessCoclosetBooking';

/**
 * WHAT THE OWNER HAS ACTUALLY EARNED.
 *
 *   > "Puedes agregar el total de earnings visible solo para el provider por sus transacciones
 *   >  completadas"
 *
 * ── `payoutTotal`, NOT `payinTotal` ────────────────────────────────────────
 * The customer pays the payin; the owner receives the payout, which is the payin minus the
 * marketplace commission and minus the cleaning fee that goes to the studio. Summing what the
 * customer paid would overstate every owner's earnings by the platform's own cut - a number
 * that is wrong in the direction people notice.
 *
 * ── "COMPLETED" MEANS PAID, AND IT IS ASKED OF THE TRANSITIONS ─────────────
 * See PAYOUT_TRANSITIONS. A rental that was declined, expired or cancelled is `isFinal` too,
 * and earned nothing - so "final" is the wrong test, however natural it reads.
 *
 * ── ONE CURRENCY ───────────────────────────────────────────────────────────
 * Money in two currencies cannot be added, and a marketplace can change currency. Rather than
 * silently summing across them, anything not in the expected currency is COUNTED SEPARATELY and
 * reported, so the caller can say "and 2 more we can't add up" instead of quietly printing a
 * total that is missing rentals or, worse, adding pesos to dollars.
 */

/**
 * @param {Array<Object>} transactions - sale transactions, with `transitions` and `payoutTotal`
 * @param {string} [currency] - the marketplace currency; inferred from the first paid sale when
 *   omitted, so a caller that does not know it still gets a coherent answer
 * @returns {{amount: number, currency: string|null, count: number, skippedCount: number}}
 *   `amount` is in subunits, the shape Sharetribe's Money uses.
 */
export const sumProviderEarnings = (transactions = [], currency = null) => {
  const sales = Array.isArray(transactions) ? transactions : [];

  const paid = sales.filter(tx => hasPaidOut(tx?.attributes?.transitions));

  // A transaction can be paid out and still carry no payoutTotal if the API was asked for a
  // narrower field set. Treated as unusable rather than as zero: zero would be a lie that
  // averages into the total, while an unusable row is something the caller can report.
  const usable = paid.filter(tx => {
    const total = tx?.attributes?.payoutTotal;
    return total && typeof total.amount === 'number' && !!total.currency;
  });

  const resolvedCurrency = currency || usable[0]?.attributes?.payoutTotal?.currency || null;

  const matching = usable.filter(tx => tx.attributes.payoutTotal.currency === resolvedCurrency);

  const amount = matching.reduce((sum, tx) => sum + tx.attributes.payoutTotal.amount, 0);

  return {
    amount,
    currency: resolvedCurrency,
    count: matching.length,
    // Paid rentals that could not be added: a different currency, or no payout total at all.
    skippedCount: paid.length - matching.length,
  };
};
