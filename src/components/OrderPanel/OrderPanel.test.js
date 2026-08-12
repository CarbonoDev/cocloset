import React from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../util/sdkLoader';
import { createListing, createStock, createUser, fakeIntl } from '../../util/testData';
import {
  renderWithProviders as render,
  testingLibrary,
  getRouteConfiguration,
  getHostedConfiguration,
} from '../../util/testHelpers';
import { TIME_SLOT_TIME } from '../../util/types';

import OrderPanel from './OrderPanel';

const { screen, waitFor } = testingLibrary;

const { Money, UUID } = sdkTypes;
const noop = () => null;

const today = new Date();
const currentYear = today.getUTCFullYear();
const m = today.getUTCMonth() + 1;
const currentMonth = m < 10 ? `0${m}` : m;
const currentDay = today.getUTCDate();

const listingTypes = [
  {
    id: 'rent-bicycles-daily',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'day',
  },
  {
    id: 'rent-bicycles-nightly',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'night',
  },
  {
    id: 'rent-bicycles-hourly',
    transactionProcess: {
      name: 'default-booking',
      alias: 'default-booking/release-1',
    },
    unitType: 'hour',
  },
  {
    id: 'sell-bicycles',
    transactionProcess: {
      name: 'default-purchase',
      alias: 'default-purchase/release-1',
    },
    unitType: 'item',
    stockType: 'multipleItems',
  },
];

const listingFields = [
  {
    key: 'cat',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['sell-bicycles'],
    },
    schemaType: 'enum',
    enumOptions: [{ option: 'cat_1', label: 'Cat 1' }, { option: 'cat_2', label: 'Cat 2' }],
    filterConfig: {
      showFilter: true,
      label: 'Cat',
      group: 'primary',
    },
    showConfig: {
      label: 'Cat',
    },
    saveConfig: {
      label: 'Cat',
    },
  },
  {
    key: 'amenities',
    scope: 'public',
    listingTypeConfig: {
      limitToListingTypeIds: true,
      listingTypeIds: ['rent-bicycles-daily', 'rent-bicycles-nightly', 'rent-bicycles-hourly'],
    },
    schemaType: 'multi-enum',
    enumOptions: [{ option: 'dog_1', label: 'Dog 1' }, { option: 'dog_2', label: 'Dog 2' }],
    filterConfig: {
      showFilter: true,
      label: 'Amenities',
      //searchMode: 'has_all',
      group: 'secondary',
    },
    showConfig: {
      label: 'Category',
    },
    saveConfig: {
      label: 'Category',
    },
  },
];

const timeSlots = [
  {
    id: new UUID(1),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-14T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-14T10:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(2),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-14T16:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-14T20:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(3),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-20T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-22T18:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(4),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-17T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth}-17T18:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
  {
    id: new UUID(5),
    type: 'timeSlot',
    attributes: {
      start: new Date(`${currentYear}-${currentMonth}-28T09:00:00Z`),
      end: new Date(`${currentYear}-${currentMonth + 1}-03T18:00:00Z`),
      type: TIME_SLOT_TIME,
    },
  },
];

const getConfig = () => {
  const hostedConfig = getHostedConfiguration();
  return {
    ...hostedConfig,
    listingFields: {
      listingFields,
    },
    listingTypes: {
      listingTypes,
    },
  };
};

const monthlyId = `${currentYear}-${currentMonth}`;
const monthlyTimeSlots = {
  [monthlyId]: {
    timeSlots,
    fetchTimeSlotsError: null,
    fetchTimeSlotsInProgress: null,
  },
};

const dayId = `${currentYear}-${currentMonth}-${currentDay}`;
const timeSlotsForDate = {
  [dayId]: {
    timeSlots,
    fetchTimeSlotsError: null,
    fetchTimeSlotsInProgress: null,
    fetchedAt: new Date().getTime(),
  },
};

const commonProps = {
  author: createUser('john-author'),
  authorLink: null,
  onSubmit: noop,
  title: 'title!',
  titleDesktop: null,
  subTitle: 'subtitle!',
  onManageDisableScrolling: noop,

  onFetchTimeSlots: noop,
  monthlyTimeSlots,
  onFetchTransactionLineItems: noop,
  onContactUser: noop,
  lineItems: [],
  fetchLineItemsInProgress: false,
  fetchLineItemsError: null,
  marketplaceCurrency: 'USD',
  dayCountAvailableForBooking: 90,
  marketplaceName: 'Test marketplace',
  showListingImage: true,

  history: {
    push: noop,
  },
  location: {
    search: '',
  },
  intl: fakeIntl,
};

describe('OrderPanel', () => {
  const config = getConfig();
  const routeConfiguration = getRouteConfiguration(config.layout);
  const stockTypeMaybe = stockType => (stockType ? { stockType } : {});
  const validListingTypes = config.listingTypes.listingTypes.map(({ id, ...rest }) => ({
    listingType: id,
    transactionType: {
      process: rest?.transactionProcess?.name,
      alias: rest?.transactionProcess?.alias,
      unitType: rest.unitType,
    },
    ...stockTypeMaybe(rest?.stockType),
  }));

  it('Booking: daily', async () => {
    const listing = createListing('listing-day', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-daily',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'day',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });
    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.bookingEndTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.requestToBook')).toBeInTheDocument();
      expect(getByText('OrderPanel.youWontBeChargedInfo')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageBooking')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Cocloset: the initial cleaning notice.
  //
  //   > "el calendario muestra el siguiente día como disponible, pero no esta
  //   >  considerando los tiempos de lavado inicial ... si la prenda ya esta en
  //   >  laundry entonces si debe aparecer disponible al siguiente día"
  //
  // BookingDatesForm's own tests cover the arithmetic. What they cannot cover is
  // the THREADING: `onLaundry` and `initialCleaningDays` live in
  // `listing.metadata`, and a rule that reads the wrong place - `publicData`, say,
  // where the rest of the panel's props come from - reads `undefined` and silently
  // never fires. That failure mode has shipped in this codebase before
  // (`publicData.category` in EditListingLaundryPanel), so it is asserted here,
  // from the listing entity down.
  // ---------------------------------------------------------------------------
  const dailyGarmentListing = (id, metadata) =>
    createListing(id, {
      title: 'the listing',
      price: new Money(1000, 'USD'),
      availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
      publicData: {
        listingType: 'rent-bicycles-daily',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'day',
      },
      metadata,
    });

  it('Booking: explains why the near dates are unavailable before the garment reaches its laundry', async () => {
    const listing = dailyGarmentListing('listing-not-at-laundry', {
      initialCleaningDays: 3,
      onLaundry: false,
    });
    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText } = render(<OrderPanel {...props} />, { config, routeConfiguration });

    await waitFor(() => {
      // A calendar that silently refuses the next three days reads as broken.
      expect(getByText('BookingDatesForm.initialCleaningNotice')).toBeInTheDocument();
    });
  });

  it('Booking: says nothing once the garment IS at the laundry', async () => {
    const listing = dailyGarmentListing('listing-at-laundry', {
      initialCleaningDays: 30,
      onLaundry: true,
    });
    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { queryByText, getByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
    });
    // Tomorrow is correct now, so the panel must look exactly as it did before this
    // feature existed - no note, no explanation, nothing.
    expect(queryByText('BookingDatesForm.initialCleaningNotice')).not.toBeInTheDocument();
  });

  it('Booking: says nothing for a listing with no stored turnaround', async () => {
    // Every listing assigned before the field existed. No migration is planned - per
    // the client, "en producción iniciaremos limpio".
    const listing = dailyGarmentListing('listing-no-turnaround', {});
    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { queryByText, getByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
    });
    expect(queryByText('BookingDatesForm.initialCleaningNotice')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Cocloset: the minimum rental length legend.
  //
  //   > "hay que mostrar una leyenda donde indique que la prenda necesita ser reservada
  //   >  por un mínimo de n días, de acuerdo al valor que haya ingresado el provider,
  //   >  siempre que n sea mayor a 1, es importante que el cliente vea esta información ya
  //   >  que de otra manera no sabrá por que no le permite reservar por menos días"
  //
  // The value lives in `publicData.minimumBookingDays`, which is where the owner's wizard
  // writes it - so this asserts the same threading the initial-cleaning notice does, and
  // the "> 1" condition, which is the whole of the client's instruction about when to show
  // it. The validation message is a different string and is deliberately left alone: it
  // fires after a failed attempt, which is exactly what the client says is too late.
  // ---------------------------------------------------------------------------
  const dailyGarmentListingWithMinimum = (id, minimumBookingDays) =>
    createListing(id, {
      title: 'the listing',
      price: new Money(1000, 'USD'),
      availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
      publicData: {
        listingType: 'rent-bicycles-daily',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'day',
        ...(minimumBookingDays === undefined ? {} : { minimumBookingDays }),
      },
      metadata: {},
    });

  const renderWithMinimum = (id, minimumBookingDays) => {
    const listing = dailyGarmentListingWithMinimum(id, minimumBookingDays);
    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    return render(<OrderPanel {...props} />, { config, routeConfiguration });
  };

  it('Booking: states the minimum rental length up front when there is one', async () => {
    const { getByText } = renderWithMinimum('listing-minimum-3', 3);

    await waitFor(() => {
      expect(getByText('BookingDatesForm.minimumBookingDaysNotice')).toBeInTheDocument();
    });
  });

  it('Booking: says nothing when the minimum is 1, which is no minimum at all', async () => {
    // A "minimum of 1 day" is the stock behaviour. Announcing it would be noise on every
    // listing in the marketplace.
    const { queryByText, getByText } = renderWithMinimum('listing-minimum-1', 1);

    await waitFor(() => {
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
    });
    expect(queryByText('BookingDatesForm.minimumBookingDaysNotice')).not.toBeInTheDocument();
  });

  it('Booking: says nothing when the owner set no minimum', async () => {
    const { queryByText, getByText } = renderWithMinimum('listing-minimum-none', undefined);

    await waitFor(() => {
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
    });
    expect(queryByText('BookingDatesForm.minimumBookingDaysNotice')).not.toBeInTheDocument();
  });

  it.each([['0', 0], ['a fraction', 2.5], ['a string', '3'], ['null', null]])(
    'Booking: says nothing for the unusable minimum %s rather than guessing',
    async (_label, minimumBookingDays) => {
      // A legend claiming a rule the picker is not enforcing is worse than no legend: it
      // tells the customer the calendar is broken when the calendar is right.
      const { queryByText, getByText } = renderWithMinimum(
        `listing-minimum-${String(minimumBookingDays)}`,
        minimumBookingDays
      );

      await waitFor(() => {
        expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
      });
      expect(queryByText('BookingDatesForm.minimumBookingDaysNotice')).not.toBeInTheDocument();
    }
  );

  it('Booking: leaves the after-the-fact validation message in place', async () => {
    // The legend is ADDITIVE. The validator still has to exist: `minimumNights` makes the
    // second calendar click silently do nothing and does not guard the typed-in inputs at
    // all, so something has to name the rule at the moment it is broken too.
    const { queryByText } = renderWithMinimum('listing-minimum-additive', 3);

    await waitFor(() => {
      expect(queryByText('BookingDatesForm.minimumBookingDaysNotice')).toBeInTheDocument();
    });
    // Not yet shown - it appears only after a failed attempt, which is the client's whole
    // complaint and the reason the legend was added alongside it.
    expect(queryByText('BookingDatesForm.minimumBookingDays')).not.toBeInTheDocument();
  });

  it('Booking: nightly', async () => {
    const listing = createListing('listing-night', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-nighlty',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'night',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });
    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('BookingDatesForm.bookingStartTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.bookingEndTitle')).toBeInTheDocument();
      expect(getByText('BookingDatesForm.requestToBook')).toBeInTheDocument();
      expect(getByText('OrderPanel.youWontBeChargedInfo')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageBooking')).toBeInTheDocument();
    });
  });

  it('Booking: hourly', async () => {
    const listing = createListing('listing-hourly', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-hourly',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'hour',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = {
      ...commonProps,
      timeSlotsForDate,
      listing,
      isOwnListing: false,
      validListingTypes,
    };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('BookingTimeForm.bookingStartTitle')).toBeInTheDocument();
      expect(getByText('FieldDateAndTimeInput.startTime')).toBeInTheDocument();
      expect(getByText('FieldDateAndTimeInput.endTime')).toBeInTheDocument();
      expect(getByText('BookingTimeForm.requestToBook')).toBeInTheDocument();
      expect(getByText('OrderPanel.youWontBeChargedInfo')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageBooking')).toBeInTheDocument();
    });
  });

  it('Booking: fixed', async () => {
    const listing = createListing('listing-fixed', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),
      availabilityPlan: {
        type: 'availability-plan/time',
        timezone: 'Etc/UTC',
        entries: [
          { dayOfWeek: 'mon', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'tue', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'wed', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'thu', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'fri', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sat', startTime: '00:00', endTime: '00:00', seats: 1 },
          { dayOfWeek: 'sun', startTime: '00:00', endTime: '00:00', seats: 0 },
        ],
      },

      publicData: {
        listingType: 'rent-bicycles-fixed',
        transactionProcessAlias: 'default-booking/release-1',
        unitType: 'fixed',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
        priceVariants: [
          {
            price: new Money(1000, 'USD'),
            bookingLengthInMinutes: 30,
          },
        ],
        startTimeInterval: 'quarterHour',
      },
    });

    const props = {
      ...commonProps,
      timeSlotsForDate,
      listing,
      isOwnListing: false,
      validListingTypes,
    };
    const { getByText, queryAllByText, queryByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('BookingFixedDurationForm.bookingStartTitle')).toBeInTheDocument();
      expect(getByText('FieldDateAndTimeInput.startTime')).toBeInTheDocument();
      expect(queryByText('FieldDateAndTimeInput.endTime')).not.toBeInTheDocument();
      expect(getByText('BookingFixedDurationForm.requestToBook')).toBeInTheDocument();
      expect(getByText('OrderPanel.youWontBeChargedInfo')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageBooking')).toBeInTheDocument();
    });
  });

  it('Purchase: item ', async () => {
    const listing = createListing(
      'listing-product',
      {
        title: 'the listing',
        description: 'Lorem ipsum',
        price: new Money(1000, 'USD'),

        publicData: {
          listingType: 'sell-bicycles',
          transactionProcessAlias: 'default-purchase/release-1',
          unitType: 'item',
          amenities: ['dog_1'],
          location: {
            address: 'Main Street 123',
            building: 'A 1',
          },
          pickupEnabled: true,
        },
      },
      {
        currentStock: createStock('stock-id', { quantity: 5 }),
      }
    );

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('ProductOrderForm.quantityLabel')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.deliveryMethodLabel')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.pickupOption')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.breakdownTitle')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.ctaButton')).toBeInTheDocument();
      expect(getByText('ProductOrderForm.finePrint')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessagePurchase')).toBeInTheDocument();
    });
  });

  it('Purchase: item (no delivery method set)', async () => {
    const listing = createListing(
      'listing-product',
      {
        title: 'the listing',
        description: 'Lorem ipsum',
        price: new Money(1000, 'USD'),

        publicData: {
          listingType: 'sell-bicycles',
          transactionProcessAlias: 'default-purchase/release-1',
          unitType: 'item',
          amenities: ['dog_1'],
          location: {
            address: 'Main Street 123',
            building: 'A 1',
          },
        },
      },
      {
        currentStock: createStock('stock-id', { quantity: 5 }),
      }
    );

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('ProductOrderForm.noDeliveryMethodSet')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessagePurchase')).toBeInTheDocument();
    });
  });

  it('Inquiry: inquiry ', async () => {
    const listing = createListing('listing-inquiry', {
      title: 'the listing',
      description: 'Lorem ipsum',
      price: new Money(1000, 'USD'),

      publicData: {
        listingType: 'inquiry',
        transactionProcessAlias: 'default-inquiry/release-1',
        unitType: 'inquiry',
        amenities: ['dog_1'],
        location: {
          address: 'Main Street 123',
          building: 'A 1',
        },
      },
    });

    const props = { ...commonProps, listing, isOwnListing: false, validListingTypes };
    const { getByText, queryAllByText } = render(<OrderPanel {...props} />, {
      config,
      routeConfiguration,
    });

    await waitFor(() => {
      expect(queryAllByText('title!')).toHaveLength(2);
      expect(queryAllByText('OrderPanel.price')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.priceInMobileCTA')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.perUnit')).toHaveLength(1);
      expect(queryAllByText('OrderPanel.author')).toHaveLength(2);
      expect(getByText('InquiryWithoutPaymentForm.ctaButton')).toBeInTheDocument();
      expect(getByText('OrderPanel.ctaButtonMessageInquiry')).toBeInTheDocument();
    });
  });
});
