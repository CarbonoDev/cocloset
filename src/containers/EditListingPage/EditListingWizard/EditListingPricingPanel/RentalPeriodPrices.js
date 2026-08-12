import React from 'react';
import classNames from 'classnames';

// Import configs and util modules
import appSettings from '../../../../config/settings';
import { useIntl } from '../../../../util/reactIntl';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import * as validators from '../../../../util/validators';
import { formatMoney } from '../../../../util/currency';
import {
  RENTAL_PERIOD_DAYS,
  getRentalPeriods,
  rentalPeriodLabel,
  rentalPeriodVariantName,
} from '../../../../util/rentalPeriods';

// Import shared components
import { FieldCurrencyInput } from '../../../../components';

// Import modules from this directory
import css from './RentalPeriodPrices.module.css';

const { Money } = sdkTypes;

/**
 * THE OWNER'S HALF OF FIXED RENTAL PERIODS.
 *
 *   > "el provider necesita establecer el precio para cada periodo en editlistingpage, un
 *   >  precio para 7 y otro para 14"
 *
 * One currency field per period, and nothing else. This deliberately does NOT reuse
 * BookingPriceVariants (the stock price-variations UI), even though the data it writes has
 * the same shape:
 *
 *   - that component lets the owner add, name, delete and reorder up to 20 variants. The
 *     periods here are a fixed pair the marketplace defines, not a list the owner composes;
 *     an owner who deleted a row, renamed one to "7 dias" or added a third would produce a
 *     listing the booking form and the server rules cannot interpret.
 *   - the variant NAME is an identity string that outlives the listing (it is stored on
 *     every transaction's protectedData and matched against on the server). Letting an owner
 *     type it is exactly how it drifts. `rentalPeriodVariantName` owns it instead, and the
 *     owner never sees it — the label they read comes from the translation file.
 *
 * What is shared with the stock machinery is the STORED shape: `publicData.priceVariants`
 * plus `listing.price` set to the cheapest variant. See src/util/rentalPeriods.js for why
 * this rides on price variants rather than a key of its own.
 */

/**
 * The form field name for a period's price.
 *
 * Flat rather than nested (`rentalPeriodPrices.7`) on purpose: final-form reads a dotted
 * path with a numeric segment as an ARRAY index, so the nested form would silently build
 * an eight-element sparse array instead of an object with a '7' key.
 *
 * @param {number} days
 * @returns {string}
 */
export const rentalPeriodFieldName = days => `rentalPeriodPrice_${days}`;

/**
 * Seed the pricing form from the listing's stored periods.
 *
 * Only periods the marketplace currently offers are seeded. A listing carrying a period
 * that has since been retired keeps it in `publicData` until the next save, at which point
 * `handleSubmitValuesForRentalPeriods` drops it — writing it back into a field the form no
 * longer renders would make it immortal.
 *
 * The stored `priceInSubunits` is rehydrated against the LISTING's currency where there is
 * one, falling back to the marketplace currency for a listing that has never been priced.
 * A Money in the wrong currency is not a display bug: FieldCurrencyInput would format it
 * with the wrong symbol and the panel's own currency check would then refuse to render the
 * form at all.
 *
 * @param {Object} params - The props given to the panel component.
 * @param {Object} params.listing - The listing entity.
 * @param {string} params.marketplaceCurrency
 * @returns {Object} initial values, keyed by rentalPeriodFieldName
 */
export const getInitialValuesForRentalPeriods = params => {
  const { listing, marketplaceCurrency } = params;
  const { price, publicData } = listing?.attributes || {};
  const currency = price?.currency || marketplaceCurrency;
  const storedPeriods = getRentalPeriods(publicData);

  return RENTAL_PERIOD_DAYS.reduce((values, days) => {
    const stored = storedPeriods.find(p => p.bookingLengthInDays === days);
    return stored
      ? { ...values, [rentalPeriodFieldName(days)]: new Money(stored.priceInSubunits, currency) }
      : values;
  }, {});
};

/**
 * Turn the submitted period prices into the listing update.
 *
 * Returns `{}` when no period has a price, so a half-filled form cannot wipe a listing's
 * existing pricing. The form's own validators require both fields, so reaching that state
 * means something other than the form submitted.
 *
 * `listing.price` is set to the CHEAPEST period. That attribute is what search cards, the
 * listing page heading and every price filter read, and the cheapest is the only value that
 * makes "from $X" true. It is also what the stock price-variations flow does, so the two
 * agree.
 *
 * @param {Object} values - The submitted form values.
 * @param {Object} publicDataUpdates - The publicData updates collected so far.
 * @param {string} marketplaceCurrency
 * @returns {Object} `{ price, publicData }`, or `{}` when there is nothing to write.
 */
export const handleSubmitValuesForRentalPeriods = (
  values,
  publicDataUpdates,
  marketplaceCurrency
) => {
  const priced = RENTAL_PERIOD_DAYS.map(days => ({
    days,
    money: values?.[rentalPeriodFieldName(days)],
  })).filter(entry => entry.money instanceof Money && Number.isInteger(entry.money.amount));

  if (priced.length === 0) {
    return {};
  }

  const currency = priced[0].money.currency || marketplaceCurrency;
  const cheapest = priced.reduce(
    (lowest, entry) => (entry.money.amount < lowest ? entry.money.amount : lowest),
    priced[0].money.amount
  );

  return {
    price: new Money(cheapest, currency),
    publicData: {
      ...publicDataUpdates,
      // Written so the stock `isPriceVariationsEnabled` helper agrees with what is actually
      // stored. Nothing in the Cocloset path depends on it — see the comment in
      // server/api-util/lineItems.js about why pricing must not key off this flag — but a
      // listing that carries priceVariants while claiming variations are disabled is a lie
      // that some future stock component will read.
      priceVariationsEnabled: true,
      priceVariants: priced.map(entry => ({
        name: rentalPeriodVariantName(entry.days),
        bookingLengthInDays: entry.days,
        priceInSubunits: entry.money.amount,
      })),
    },
  };
};

const getPriceValidators = (listingMinimumPriceSubUnits, marketplaceCurrency, intl) => {
  const priceRequired = validators.required(
    intl.formatMessage({ id: 'EditListingPricingForm.priceRequired' })
  );

  const minPriceRaw = new Money(listingMinimumPriceSubUnits, marketplaceCurrency);
  const minPriceRequired = validators.moneySubUnitAmountAtLeast(
    intl.formatMessage(
      { id: 'EditListingPricingForm.priceTooLow' },
      { minPrice: formatMoney(intl, minPriceRaw) }
    ),
    listingMinimumPriceSubUnits
  );

  return listingMinimumPriceSubUnits
    ? validators.composeValidators(priceRequired, minPriceRequired)
    : priceRequired;
};

/**
 * The RentalPeriodPrices component: one flat price per rental period.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.formId] - The form id, used to build input ids
 * @param {string} [props.className] - Custom class for each field
 * @param {string} props.marketplaceCurrency - The marketplace currency
 * @param {number} [props.listingMinimumPriceSubUnits] - The listing minimum price sub units
 * @param {boolean} [props.autoFocus] - Whether the first input should be focused
 * @returns {JSX.Element}
 */
const RentalPeriodPrices = props => {
  const intl = useIntl();
  const {
    formId = 'EditListingPricingForm',
    className,
    marketplaceCurrency,
    listingMinimumPriceSubUnits = 0,
    autoFocus,
  } = props;

  const validate = getPriceValidators(listingMinimumPriceSubUnits, marketplaceCurrency, intl);

  return (
    <div className={classNames(css.root, className)}>
      <p className={css.explanation}>
        {intl.formatMessage({ id: 'RentalPeriodPrices.explanation' })}
      </p>

      {RENTAL_PERIOD_DAYS.map((days, index) => (
        <FieldCurrencyInput
          key={days}
          id={`${formId}_${rentalPeriodFieldName(days)}`}
          name={rentalPeriodFieldName(days)}
          className={css.priceInput}
          autoFocus={autoFocus && index === 0}
          label={intl.formatMessage(
            { id: 'RentalPeriodPrices.priceLabel' },
            { period: rentalPeriodLabel(intl, days) }
          )}
          placeholder={intl.formatMessage({
            id: 'EditListingPricingForm.priceInputPlaceholder',
          })}
          currencyConfig={appSettings.getCurrencyFormatting(marketplaceCurrency)}
          validate={validate}
        />
      ))}
    </div>
  );
};

export default RentalPeriodPrices;
