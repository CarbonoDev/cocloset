const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

// Silences the (correct) error log a malformed CLEANING_FEE_* value emits — the log
// itself is asserted in cleaningFeeEnv.test.js, and letting it print here just buries
// real failures in the suite output.
jest.mock('../log', () => ({ error: jest.fn() }));

// resolveCleaningFeeInSubunits() used to call the Integration SDK to read the assigned
// laundry's privateData.cleaningFee. It no longer reads any laundry data at all — the fee
// is server env configuration now (CLEANING_FEE_<CATEGORY_ID>, see cleaningFeeEnv.js).
// The Integration SDK is still mocked here so the tests below can assert that NOTHING
// looks a laundry up on the pricing path: a stored fee that could still reach an invoice
// is the exact bug that change removed.
//
// resolveSpecialHandlingFeeInSubunits(), unlike the cleaning fee, DOES call the
// Integration SDK — to re-fetch the LISTING itself (not a laundry) and read its own
// `privateData.specialCare`, which the caller's own session SDK cannot see. Hence
// `listings.show` is mocked here too.
const mockUsersShow = jest.fn();
const mockListingsShow = jest.fn();
jest.mock('./integrationSdk', () => ({
  getIntegrationSdk: jest.fn(() => ({
    users: {
      show: mockUsersShow,
    },
    listings: {
      show: mockListingsShow,
    },
  })),
}));

const { getIntegrationSdk } = require('./integrationSdk');

const {
  calculateTotalPriceFromQuantity,
  calculateTotalPriceFromPercentage,
  calculateTotalPriceFromSeats,
  calculateQuantityFromDates,
  calculateQuantityFromHours,
  calculateLineTotal,
  calculateShippingFee,
  calculateTotalFromLineItems,
  calculateTotalForProvider,
  calculateTotalForCustomer,
  constructValidLineItems,
  hasCommissionPercentage,
  hasMinimumCommission,
  getProviderCommissionMaybe,
  getCustomerCommissionMaybe,
  getCleaningFeeLineItemMaybe,
  resolveCleaningFeeInSubunits,
  getSpecialHandlingFeeLineItemMaybe,
  resolveSpecialHandlingFeeInSubunits,
} = require('./lineItemHelpers');

const { resetReportedMalformedEnvVars } = require('./cleaningFeeEnv');
const {
  resetReportedMalformed: resetReportedSpecialHandlingMalformed,
} = require('./specialHandlingFeeEnv');

describe('calculateTotalPriceFromQuantity()', () => {
  it('should calculate price based on quantity', () => {
    const unitPrice = new Money(1000, 'EUR');
    const quantity = 3;
    expect(calculateTotalPriceFromQuantity(unitPrice, quantity)).toEqual(new Money(3000, 'EUR'));
  });
});

describe('calculateTotalPriceFromPercentage()', () => {
  it('should calculate price based on percentage', () => {
    const unitPrice = new Money(1000, 'EUR');
    const percentage = 10;
    expect(calculateTotalPriceFromPercentage(unitPrice, percentage)).toEqual(new Money(100, 'EUR'));
  });

  it('should return negative sum if percentage is negative', () => {
    const unitPrice = new Money(1000, 'EUR');
    const percentage = -10;
    expect(calculateTotalPriceFromPercentage(unitPrice, percentage)).toEqual(
      new Money(-100, 'EUR')
    );
  });
});

describe('calculateTotalPriceFromSeats()', () => {
  it('should calculate price based on seats and units', () => {
    const unitPrice = new Money(1000, 'EUR');
    const unitCount = 1;
    const seats = 3;
    expect(calculateTotalPriceFromSeats(unitPrice, unitCount, seats)).toEqual(
      new Money(3000, 'EUR')
    );
  });

  it('should throw error if value of seats is negative', () => {
    const unitPrice = new Money(1000, 'EUR');
    const unitCount = 1;
    const seats = -3;
    expect(() => calculateTotalPriceFromSeats(unitPrice, unitCount, seats)).toThrow(
      "Value of seats can't be negative"
    );
  });
});

describe('calculateQuantityFromDates()', () => {
  it('should calculate quantity based on given dates with nightly bookings', () => {
    const start = new Date(2017, 0, 1);
    const end = new Date(2017, 0, 3);
    const type = 'line-item/night';
    expect(calculateQuantityFromDates(start, end, type)).toEqual(2);
  });

  it('should calculate quantity based on given dates with daily bookings', () => {
    const start = new Date(2017, 0, 1);
    const end = new Date(2017, 0, 3);
    const type = 'line-item/day';
    expect(calculateQuantityFromDates(start, end, type)).toEqual(2);
  });

  it('should throw error if unit type is not night or day', () => {
    const start = new Date(2017, 0, 1);
    const end = new Date(2017, 0, 3);
    const type = 'line-item/units';
    expect(() => calculateQuantityFromDates(start, end, type)).toThrow(
      `Can't calculate quantity from dates to unit type: ${type}`
    );
  });
});

describe('calculateQuantityFromHours()', () => {
  it('should calculate quantity based on given dates with hourly bookings', () => {
    const start = new Date(2017, 0, 1, 12, 0, 0);
    const end = new Date(2017, 0, 1, 16, 0, 0);
    expect(calculateQuantityFromHours(start, end)).toEqual(4);
  });

  it('should calculate quantity based on given dates with hourly bookings', () => {
    const start = new Date(2017, 0, 1, 12, 30, 0);
    const end = new Date(2017, 0, 1, 16, 0, 0);
    expect(calculateQuantityFromHours(start, end)).toEqual(3.5);
  });
});

describe('calculateLineTotal()', () => {
  it('should calculate lineTotal for lineItem with quantity', () => {
    const lineItem = {
      code: 'line-item/cleaning-fee',
      unitPrice: new Money(1000, 'EUR'),
      quantity: 3,
      includeFor: ['customer', 'provider'],
    };
    expect(calculateLineTotal(lineItem)).toEqual(new Money(3000, 'EUR'));
  });

  it('should calculate lineTotal for lineItem with percentage', () => {
    const lineItem = {
      code: 'line-item/customer-commission',
      unitPrice: new Money(3000, 'EUR'),
      percentage: 10,
      includeFor: ['customer', 'provider'],
    };
    expect(calculateLineTotal(lineItem)).toEqual(new Money(300, 'EUR'));
  });

  it('should calculate lineTotal for lineItem with percentage=0', () => {
    const lineItem = {
      code: 'line-item/customer-commission',
      unitPrice: new Money(3000, 'EUR'),
      percentage: 0,
      includeFor: ['customer', 'provider'],
    };
    expect(calculateLineTotal(lineItem)).toEqual(new Money(0, 'EUR'));
  });

  it('should calculate lineTotal for lineItem with seats and units', () => {
    const lineItem = {
      code: 'line-item/customer-fee',
      unitPrice: new Money(1000, 'EUR'),
      seats: 4,
      units: 2,
      includeFor: ['customer', 'provider'],
    };
    expect(calculateLineTotal(lineItem)).toEqual(new Money(8000, 'EUR'));
  });

  it('should throw error if no pricing params are found', () => {
    const lineItem = {
      code: 'line-item/customer-fee',
      unitPrice: new Money(1000, 'EUR'),
      includeFor: ['customer', 'provider'],
    };
    const code = lineItem.code;
    expect(() => calculateLineTotal(lineItem)).toThrow(
      `Can't calculate the lineTotal of lineItem: ${code}. Make sure the lineItem has quantity, percentage or both seats and units`
    );
  });
});

describe('calculateShippingFee()', () => {
  it('should calculate shipping with quantity 1', () => {
    const shippingPriceInSubunitsOneItem = 1000;
    const shippingPriceInSubunitsAdditionalItems = 100;
    const currency = 'EUR';
    const quantity = 1;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(new Money(1000, 'EUR'));
  });

  it('should calculate shipping with quantity 2', () => {
    const shippingPriceInSubunitsOneItem = 1000;
    const shippingPriceInSubunitsAdditionalItems = 100;
    const currency = 'EUR';
    const quantity = 2;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(new Money(1100, 'EUR'));
  });

  it('should calculate shipping with quantity 3', () => {
    const shippingPriceInSubunitsOneItem = 1000;
    const shippingPriceInSubunitsAdditionalItems = 100;
    const currency = 'EUR';
    const quantity = 3;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(new Money(1200, 'EUR'));
  });

  it('should calculate shipping with quantity 2 and additional fee 0', () => {
    const shippingPriceInSubunitsOneItem = 1000;
    const shippingPriceInSubunitsAdditionalItems = 0;
    const currency = 'EUR';
    const quantity = 2;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(new Money(1000, 'EUR'));
  });

  it('should calculate shipping with quantity 2, base fee 0, and additional fee 0', () => {
    const shippingPriceInSubunitsOneItem = 0;
    const shippingPriceInSubunitsAdditionalItems = 0;
    const currency = 'EUR';
    const quantity = 2;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(new Money(0, 'EUR'));
  });
  it('should calculate shipping with quantity 2, base fee 0, and additional fee 100', () => {
    const shippingPriceInSubunitsOneItem = 0;
    const shippingPriceInSubunitsAdditionalItems = 100;
    const currency = 'EUR';
    const quantity = 2;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(new Money(100, 'EUR'));
  });

  it('should calculate shipping with quantity 1, negative fee', () => {
    const shippingPriceInSubunitsOneItem = -1000;
    const shippingPriceInSubunitsAdditionalItems = -100;
    const currency = 'EUR';
    const quantity = 1;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(null);
  });

  it('should calculate shipping with quantity 2, negative fees', () => {
    const shippingPriceInSubunitsOneItem = -1000;
    const shippingPriceInSubunitsAdditionalItems = -100;
    const currency = 'EUR';
    const quantity = 2;
    const shippingFee = calculateShippingFee(
      shippingPriceInSubunitsOneItem,
      shippingPriceInSubunitsAdditionalItems,
      currency,
      quantity
    );
    expect(shippingFee).toEqual(null);
  });
});

describe('calculateTotalFromLineItems()', () => {
  it('should calculate total of given lineItems lineTotals', () => {
    const lineItems = [
      {
        code: 'line-item/night',
        unitPrice: new Money(10000, 'USD'),
        quantity: 3,
        includeFor: ['customer', 'provider'],
      },

      {
        code: 'line-item/cleaning-fee',
        unitPrice: new Money(5000, 'USD'),
        quantity: 1,
        includeFor: ['customer', 'provider'],
      },
    ];
    expect(calculateTotalFromLineItems(lineItems)).toEqual(new Money(35000, 'USD'));
  });
});

describe('calculateTotalForProvider()', () => {
  it('should calculate total of lineItems where includeFor includes provider', () => {
    const lineItems = [
      {
        code: 'line-item/night',
        unitPrice: new Money(5000, 'USD'),
        units: 3,
        seats: 2,
        includeFor: ['customer', 'provider'],
      },
      {
        code: 'line-item/cleaning-fee',
        unitPrice: new Money(7500, 'USD'),
        quantity: 1,
        lineTotal: new Money(7500, 'USD'),
        includeFor: ['customer', 'provider'],
      },
      {
        code: 'line-item/customer-commission',
        unitPrice: new Money(30000, 'USD'),
        percentage: 10,
        includeFor: ['customer'],
      },
      {
        code: 'line-item/provider-commission',
        unitPrice: new Money(30000, 'USD'),
        percentage: -10,
        includeFor: ['provider'],
      },
      {
        code: 'line-item/provider-commission-discount',
        unitPrice: new Money(2500, 'USD'),
        quantity: 1,
        lineTotal: new Money(2500, 'USD'),
        includeFor: ['provider'],
      },
    ];
    expect(calculateTotalForProvider(lineItems)).toEqual(new Money(37000, 'USD'));
  });
});

describe('calculateTotalForCustomer()', () => {
  it('should calculate total of lineItems where includeFor includes customer', () => {
    const lineItems = [
      {
        code: 'line-item/night',
        unitPrice: new Money(5000, 'USD'),
        units: 3,
        seats: 2,
        includeFor: ['customer', 'provider'],
      },
      {
        code: 'line-item/cleaning-fee',
        unitPrice: new Money(7500, 'USD'),
        quantity: 1,
        lineTotal: new Money(7500, 'USD'),
        includeFor: ['customer', 'provider'],
      },
      {
        code: 'line-item/customer-commission',
        unitPrice: new Money(30000, 'USD'),
        percentage: 10,
        includeFor: ['customer'],
      },
      {
        code: 'line-item/provider-commission',
        unitPrice: new Money(30000, 'USD'),
        percentage: -10,
        includeFor: ['provider'],
      },
      {
        code: 'line-item/provider-commission-discount',
        unitPrice: new Money(2500, 'USD'),
        quantity: 1,
        lineTotal: new Money(2500, 'USD'),
        includeFor: ['provider'],
      },
    ];
    expect(calculateTotalForCustomer(lineItems)).toEqual(new Money(40500, 'USD'));
  });
});

describe('constructValidLineItems()', () => {
  it('should add lineTotal and reversal attributes to the lineItem', () => {
    const lineItems = [
      {
        code: 'line-item/night',
        unitPrice: new Money(5000, 'USD'),
        quantity: 2,
        includeFor: ['customer', 'provider'],
      },
    ];
    expect(constructValidLineItems(lineItems)[0].lineTotal).toEqual(new Money(10000, 'USD'));
    expect(constructValidLineItems(lineItems)[0].reversal).toEqual(false);
    expect(constructValidLineItems(lineItems)[0].reversal).not.toBeUndefined();
  });

  it('should throw error if lineItem code is not valid', () => {
    const code = 'nights';
    const lineItems = [
      {
        code,
        unitPrice: new Money(5000, 'USD'),
        quantity: 2,
        includeFor: ['customer', 'provider'],
      },
    ];

    expect(() => constructValidLineItems(lineItems)).toThrow(`Invalid line item code: ${code}`);
  });
});

describe('hasCommissionPercentage()', () => {
  it('should return false with object that does not contain percentage', () => {
    expect(hasCommissionPercentage({})).toBe(false);
    expect(hasCommissionPercentage({ foo: 'bar' })).toBe(false);
  });
  it('should return true with object that does contain percentage', () => {
    expect(hasCommissionPercentage({ percentage: 10 })).toBe(true);
    expect(hasCommissionPercentage({ percentage: 10, foo: 'bar' })).toBe(true);
  });
  it('should return false with object that contains percentage zero', () => {
    expect(hasCommissionPercentage({ percentage: 0 })).toBe(false);
  });

  it('should throw error if percentage property does not contain number', () => {
    expect(() => hasCommissionPercentage({ percentage: '10' })).toThrow('10 is not a number.');
    expect(() => hasCommissionPercentage({ percentage: 'asdf' })).toThrow('asdf is not a number.');
  });
});

describe('hasMinimumCommission()', () => {
  it('should return false with object that does not contain minimum commission', () => {
    expect(hasMinimumCommission({})).toBe(false);
    expect(hasMinimumCommission({ foo: 'bar' })).toBe(false);
  });
  it('should return true with object that does contain minimum commission', () => {
    expect(hasMinimumCommission({ minimum_amount: 10 })).toBe(true);
    expect(hasMinimumCommission({ minimum_amount: 10, foo: 'bar' })).toBe(true);
  });
  it('should return false with object that contains minimum commission zero', () => {
    expect(hasMinimumCommission({ minimum_amount: 0 })).toBe(false);
  });

  it('should throw error if minimum commission property does not contain number', () => {
    expect(() => hasMinimumCommission({ minimum_amount: '10' })).toThrow('10 is not a number.');
    expect(() => hasMinimumCommission({ minimum_amount: 'asdf' })).toThrow('asdf is not a number.');
  });
});

describe('getProviderCommissionMaybe()', () => {
  const currency = 'USD';

  const order = {
    code: 'line-item/night',
    unitPrice: new Money(10000, 'USD'),
    units: 1,
    seats: 1,
    includeFor: ['customer', 'provider'],
  };

  const expectedLineItemsPercentage = [
    {
      code: 'line-item/provider-commission',
      unitPrice: new Money(10000, 'USD'),
      percentage: -5,
      includeFor: ['provider'],
    },
  ];

  const expectedLineItemsFixed = [
    {
      code: 'line-item/provider-commission',
      unitPrice: new Money(250, 'USD'),
      quantity: -1,
      includeFor: ['provider'],
    },
  ];

  // Returns an empty array
  it('should return an empty array when both percentage and minimum commission are null in provider commission', () => {
    const commission = {
      minimum_amount: null,
      percentage: null,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual([]);
  });
  it('should return an empty array when both percentage and minimum commission are undefined in provider commission', () => {
    const commission = {};
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual([]);
  });
  it('should return an empty array when both percentage and minimum commission are negative in provider commission', () => {
    const commission = {
      minimum_amount: -250,
      percentage: -5,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual([]);
  });
  it('should throw an error when percentage is not a number in provider commission', () => {
    const commission = {
      percentage: '5',
    };
    expect(() => getProviderCommissionMaybe(commission, order, currency)).toThrow(
      '5 is not a number'
    );
  });
  it('should return throw an error when minimum commission is not a number in provider commission', () => {
    const commission = {
      minimum_amount: '250',
    };
    expect(() => getProviderCommissionMaybe(commission, order, currency)).toThrow(
      '250 is not a number'
    );
  });

  // Returns correct percentage line items
  it('should return correct line items when a percentage is provided and minimum commission is null in provider commission', () => {
    const commission = {
      minimum_amount: null,
      percentage: 5,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });
  it('should return correct line items when a percentage is provided and minimum commission is undefined in provider commission', () => {
    const commission = {
      percentage: 5,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });
  it('should return correct line items when a percentage is provided and minimum commission is negative in provider commission', () => {
    const commission = {
      minimum_amount: -250,
      percentage: 5,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });
  it('should return correct line items when a percentage is provided and minimum commission is a lower value in provider commission', () => {
    const commission = {
      minimum_amount: 250,
      percentage: 5,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });

  // Returns correct fixed line items
  it('should return correct line items when a minimum commission is provided and percentage is null in provider commission', () => {
    const commission = {
      minimum_amount: 250,
      percentage: null,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(expectedLineItemsFixed);
  });
  it('should return correct line items when a minimum commission is provided and percentage is undefined in provider commission', () => {
    const commission = {
      minimum_amount: 250,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(expectedLineItemsFixed);
  });
  it('should return correct line items when a minimum commission is provided and percentage is negative in provider commission', () => {
    const commission = {
      minimum_amount: 250,
      percentage: -5,
    };
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(expectedLineItemsFixed);
  });
  it('should return correct line items when a minimum commission is provided and percentage is a lower value in provider commission', () => {
    const commission = {
      minimum_amount: 1500,
      percentage: 5,
    };
    const expectedLineItems = [
      {
        code: 'line-item/provider-commission',
        unitPrice: new Money(1500, 'USD'),
        quantity: -1,
        includeFor: ['provider'],
      },
    ];
    expect(getProviderCommissionMaybe(commission, order, currency)).toEqual(expectedLineItems);
  });
});

describe('getCustomerCommissionMaybe()', () => {
  const currency = 'USD';

  const order = {
    code: 'line-item/night',
    unitPrice: new Money(10000, 'USD'),
    units: 1,
    seats: 1,
    includeFor: ['customer', 'provider'],
  };

  const expectedLineItemsPercentage = [
    {
      code: 'line-item/customer-commission',
      unitPrice: new Money(10000, 'USD'),
      percentage: 5,
      includeFor: ['customer'],
    },
  ];

  const expectedLineItemsFixed = [
    {
      code: 'line-item/customer-commission',
      unitPrice: new Money(250, 'USD'),
      quantity: 1,
      includeFor: ['customer'],
    },
  ];

  // Returns an empty array
  it('should return an empty array when both percentage and minimum commission are null in customer commission', () => {
    const commission = {
      minimum_amount: null,
      percentage: null,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual([]);
  });
  it('should return an empty array when both percentage and minimum commission are undefined in customer commission', () => {
    const commission = {};
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual([]);
  });
  it('should return an empty array when both percentage and minimum commission are negative in customer commission', () => {
    const commission = {
      minimum_amount: -250,
      percentage: -5,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual([]);
  });
  it('should throw an error when percentage is not a number in customer commission', () => {
    const commission = {
      percentage: '5',
    };
    expect(() => getCustomerCommissionMaybe(commission, order, currency)).toThrow(
      '5 is not a number'
    );
  });
  it('should return throw an error when minimum commission is not a number in customer commission', () => {
    const commission = {
      minimum_amount: '250',
    };
    expect(() => getCustomerCommissionMaybe(commission, order, currency)).toThrow(
      '250 is not a number'
    );
  });

  // Returns correct percentage line items
  it('should return correct line items when a percentage is provided and minimum commission is null in customer commission', () => {
    const commission = {
      minimum_amount: null,
      percentage: 5,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });
  it('should return correct line items when a percentage is provided and minimum commission is undefined in customer commission', () => {
    const commission = {
      percentage: 5,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });
  it('should return correct line items when a percentage is provided and minimum commission is negative in customer commission', () => {
    const commission = {
      minimum_amount: -250,
      percentage: 5,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });
  it('should return correct line items when a percentage is provided and minimum commission is a lower value in customer commission', () => {
    const commission = {
      minimum_amount: 250,
      percentage: 5,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(
      expectedLineItemsPercentage
    );
  });

  // Returns correct fixed line items
  it('should return correct line items when a minimum commission is provided and percentage is null in customer commission', () => {
    const commission = {
      minimum_amount: 250,
      percentage: null,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(expectedLineItemsFixed);
  });
  it('should return correct line items when a minimum commission is provided and percentage is undefined in customer commission', () => {
    const commission = {
      minimum_amount: 250,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(expectedLineItemsFixed);
  });
  it('should return correct line items when a minimum commission is provided and percentage is negative in customer commission', () => {
    const commission = {
      minimum_amount: 250,
      percentage: -5,
    };
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(expectedLineItemsFixed);
  });
  it('should return correct line items when a minimum commission is provided and percentage is a lower value in customer commission', () => {
    const commission = {
      minimum_amount: 1500,
      percentage: 5,
    };
    const expectedLineItems = [
      {
        code: 'line-item/customer-commission',
        unitPrice: new Money(1500, 'USD'),
        quantity: 1,
        includeFor: ['customer'],
      },
    ];
    expect(getCustomerCommissionMaybe(commission, order, currency)).toEqual(expectedLineItems);
  });
});

describe('getCleaningFeeLineItemMaybe()', () => {
  it('should return a cleaning-fee line item for a positive amount', () => {
    expect(getCleaningFeeLineItemMaybe(1250, 'EUR')).toEqual([
      {
        code: 'line-item/cleaning-fee',
        unitPrice: new Money(1250, 'EUR'),
        quantity: 1,
        includeFor: ['customer'],
      },
    ]);
  });

  it('should return an empty array for a zero amount (no cleaning fee to charge)', () => {
    expect(getCleaningFeeLineItemMaybe(0, 'EUR')).toEqual([]);
  });

  it('should return an empty array when the amount is not a valid number', () => {
    expect(getCleaningFeeLineItemMaybe(undefined, 'EUR')).toEqual([]);
    expect(getCleaningFeeLineItemMaybe(null, 'EUR')).toEqual([]);
    expect(getCleaningFeeLineItemMaybe(NaN, 'EUR')).toEqual([]);
    expect(getCleaningFeeLineItemMaybe(-500, 'EUR')).toEqual([]);
  });

  it('should return an empty array when currency is missing', () => {
    expect(getCleaningFeeLineItemMaybe(1000, null)).toEqual([]);
  });
});

describe('resolveCleaningFeeInSubunits()', () => {
  // Every fee-bearing var is set on process.env here rather than injected, because that
  // is how the function is really called: it reads the process environment. Snapshot and
  // restore the whole set so one test's fee cannot decide another's.
  const FEE_VARS = [
    'DEFAULT_CLEANING_FEE',
    'CLEANING_FEE_DRESSES',
    'CLEANING_FEE_MIDI_DRESS',
    'CLEANING_FEE_PANTS',
  ];
  const originalEnv = {};

  beforeEach(() => {
    FEE_VARS.forEach(name => {
      originalEnv[name] = process.env[name];
      delete process.env[name];
    });
    // jest config has resetMocks: true, which wipes mock implementations (not just call
    // history) before every test - including the one set by the jest.mock() factory
    // above - so getIntegrationSdk() needs to be re-armed here on every test.
    getIntegrationSdk.mockReturnValue({ users: { show: mockUsersShow } });
    resetReportedMalformedEnvVars();
  });

  afterEach(() => {
    FEE_VARS.forEach(name => {
      if (originalEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = originalEnv[name];
      }
    });
  });

  // The laundry id is in `metadata` (Integration-API-only); the category chain stays in
  // `publicData`, which is where Console writes it.
  const listingWithLaundry = (laundryId, categoryLevels = {}) => ({
    attributes: {
      metadata: { assignedLaundryId: laundryId },
      publicData: { ...categoryLevels },
    },
  });

  const listingWithoutLaundry = { attributes: { publicData: {} } };

  const midiDressListing = laundryId =>
    listingWithLaundry(laundryId, {
      categoryLevel1: 'dresses',
      categoryLevel2: 'midi_dress',
    });

  // ── THE FEE COMES FROM THE ENVIRONMENT ─────────────────────────────────────
  // This is the money path: the number these tests pin is what lands on a customer's
  // invoice. The resolution rule itself is unit-tested exhaustively in
  // cleaningFeeEnv.test.js; these check that resolveCleaningFeeInSubunits feeds it the
  // LISTING's own category chain, converts to subunits, and never consults a laundry.

  it("charges the env fee configured for THIS garment's category", async () => {
    process.env.DEFAULT_CLEANING_FEE = '8';
    process.env.CLEANING_FEE_MIDI_DRESS = '22';

    // 22.00 EUR in cents, not the marketplace default 8.
    expect(await resolveCleaningFeeInSubunits(midiDressListing('laundry-1'), 'EUR')).toBe(2200);
  });

  it('charges the HIGHEST matching category fee, not the most specific one', async () => {
    // The rule the client asked for: "utilizaría el precio mas alto". The subcategory is
    // CHEAPER here, which is the case that separates highest-wins from deepest-wins — a
    // most-specific implementation charges 800 and fails.
    process.env.CLEANING_FEE_DRESSES = '10';
    process.env.CLEANING_FEE_MIDI_DRESS = '8';

    expect(await resolveCleaningFeeInSubunits(midiDressListing('laundry-1'), 'EUR')).toBe(1000);
  });

  it('falls back to DEFAULT_CLEANING_FEE for a category with no var of its own', async () => {
    process.env.DEFAULT_CLEANING_FEE = '8';
    process.env.CLEANING_FEE_DRESSES = '22';

    const listing = listingWithLaundry('laundry-1', { categoryLevel1: 'pants' });

    expect(await resolveCleaningFeeInSubunits(listing, 'EUR')).toBe(800);
  });

  it('converts a fractional major-unit fee to subunits, rounding half up', async () => {
    process.env.CLEANING_FEE_DRESSES = '12.505';

    const listing = listingWithLaundry('laundry-1', { categoryLevel1: 'dresses' });

    expect(await resolveCleaningFeeInSubunits(listing, 'EUR')).toBe(1251);
  });

  it('treats an explicit env fee of 0 as configured — free, no line item', async () => {
    process.env.DEFAULT_CLEANING_FEE = '8';
    process.env.CLEANING_FEE_MIDI_DRESS = '0';

    // 0 wins over the default because the default is a fallback, not a competitor, and a
    // zero fee simply adds no cleaning-fee line item.
    expect(await resolveCleaningFeeInSubunits(midiDressListing('laundry-1'), 'EUR')).toBe(0);
  });

  it('charges nothing when no category var and no default are set', async () => {
    const listing = listingWithLaundry('laundry-1', { categoryLevel1: 'dresses' });

    expect(await resolveCleaningFeeInSubunits(listing, 'EUR')).toBe(0);
  });

  it('uses the marketplace default for an uncategorised listing', async () => {
    process.env.DEFAULT_CLEANING_FEE = '15';

    expect(await resolveCleaningFeeInSubunits(listingWithoutLaundry, 'EUR')).toBe(1500);
  });

  it('ignores a MALFORMED env fee rather than charging 0', async () => {
    // A typo must not silently zero the charge: resolution falls through to the next
    // configured level, exactly as if the var were unset.
    process.env.DEFAULT_CLEANING_FEE = '8';
    process.env.CLEANING_FEE_MIDI_DRESS = 'twenty-two';

    expect(await resolveCleaningFeeInSubunits(midiDressListing('laundry-1'), 'EUR')).toBe(800);
  });

  it('never throws, whatever the listing looks like', async () => {
    process.env.DEFAULT_CLEANING_FEE = '8';

    expect(await resolveCleaningFeeInSubunits(undefined, 'EUR')).toBe(800);
    expect(await resolveCleaningFeeInSubunits({}, 'EUR')).toBe(800);
    expect(await resolveCleaningFeeInSubunits({ attributes: {} }, 'EUR')).toBe(800);
  });

  it('returns 0 when no currency is given', async () => {
    process.env.DEFAULT_CLEANING_FEE = '8';

    expect(await resolveCleaningFeeInSubunits(listingWithoutLaundry, null)).toBe(0);
  });

  // ── NO LAUNDRY DATA REACHES A PRICE ────────────────────────────────────────
  // These replace the old isLaundry security tests. Those pinned that a fee stored by a
  // user who is not a flagged laundry could not be honoured; the guarantee is now
  // stronger and simpler — NO stored fee is honoured, from anyone, because the pricing
  // path does not read a profile at all. Nothing about a de-flagged laundry, a listing
  // migrated off the old provider-writable publicData.assignedLaundryId, or a rogue
  // assignedLaundryId can move a customer's payin total any more.

  it('makes no Integration API call at all', async () => {
    process.env.CLEANING_FEE_DRESSES = '22';

    const listing = listingWithLaundry('laundry-1', { categoryLevel1: 'dresses' });
    await resolveCleaningFeeInSubunits(listing, 'EUR');

    expect(mockUsersShow).not.toHaveBeenCalled();
    expect(getIntegrationSdk).not.toHaveBeenCalled();
  });

  it("ignores a stored privateData.cleaningFee, even a real laundry's", async () => {
    // Dead data. The form no longer collects it, and leaving a reader in place would let
    // a stale stored value keep pricing rentals after the input was removed — which is
    // precisely the bug this change exists to remove.
    process.env.DEFAULT_CLEANING_FEE = '8';
    mockUsersShow.mockResolvedValue({
      data: {
        data: {
          attributes: {
            profile: { metadata: { isLaundry: true }, privateData: { cleaningFee: 99 } },
          },
        },
      },
    });

    expect(await resolveCleaningFeeInSubunits(listingWithLaundry('laundry-1'), 'EUR')).toBe(800);
    expect(mockUsersShow).not.toHaveBeenCalled();
  });

  it('ignores a stored per-category cleaningFee table', async () => {
    process.env.DEFAULT_CLEANING_FEE = '8';
    mockUsersShow.mockResolvedValue({
      data: {
        data: {
          attributes: {
            profile: {
              metadata: { isLaundry: true },
              privateData: { categoryPricing: { midi_dress: { cleaningFee: 5000 } } },
            },
          },
        },
      },
    });

    expect(await resolveCleaningFeeInSubunits(midiDressListing('laundry-1'), 'EUR')).toBe(800);
  });

  it('cannot be influenced by pointing assignedLaundryId at any user', async () => {
    // The original attack: the id used to be provider-controlled publicData on the
    // provider's own listing, so a provider could point it at themselves and set their
    // own privateData.cleaningFee, zeroing the fee or inflating every customer's payin
    // total. There is nothing left to point at.
    process.env.CLEANING_FEE_DRESSES = '10';
    mockUsersShow.mockResolvedValue({
      data: { data: { attributes: { profile: { privateData: { cleaningFee: 5000 } } } } },
    });

    const listing = listingWithLaundry('rogue-user', { categoryLevel1: 'dresses' });

    expect(await resolveCleaningFeeInSubunits(listing, 'EUR')).toBe(1000);
  });

  it('charges the same for a listing with no assigned laundry as for one with', async () => {
    // The fee is a property of the garment's category, not of who cleans it.
    process.env.CLEANING_FEE_DRESSES = '11';

    const assigned = listingWithLaundry('laundry-1', { categoryLevel1: 'dresses' });
    const unassigned = { attributes: { publicData: { categoryLevel1: 'dresses' } } };

    expect(await resolveCleaningFeeInSubunits(assigned, 'EUR')).toBe(1100);
    expect(await resolveCleaningFeeInSubunits(unassigned, 'EUR')).toBe(1100);
  });
});

describe('getSpecialHandlingFeeLineItemMaybe()', () => {
  it('should return a special-handling-fee line item for a positive amount', () => {
    expect(getSpecialHandlingFeeLineItemMaybe(1500, 'USD')).toEqual([
      {
        code: 'line-item/special-handling-fee',
        unitPrice: new Money(1500, 'USD'),
        quantity: 1,
        includeFor: ['customer'],
      },
    ]);
  });

  it('should return an empty array for a zero amount (fee disabled via env)', () => {
    expect(getSpecialHandlingFeeLineItemMaybe(0, 'USD')).toEqual([]);
  });

  it('should return an empty array when the amount is not a valid number', () => {
    expect(getSpecialHandlingFeeLineItemMaybe(undefined, 'USD')).toEqual([]);
    expect(getSpecialHandlingFeeLineItemMaybe(null, 'USD')).toEqual([]);
    expect(getSpecialHandlingFeeLineItemMaybe(NaN, 'USD')).toEqual([]);
    expect(getSpecialHandlingFeeLineItemMaybe(-500, 'USD')).toEqual([]);
  });

  it('should return an empty array when currency is missing', () => {
    expect(getSpecialHandlingFeeLineItemMaybe(1500, null)).toEqual([]);
  });
});

describe('resolveSpecialHandlingFeeInSubunits()', () => {
  const originalEnv = process.env.SPECIAL_HANDLING_FEE;

  beforeEach(() => {
    delete process.env.SPECIAL_HANDLING_FEE;
    // jest config has resetMocks: true, so the jest.mock() factory's implementation is
    // wiped before every test.
    getIntegrationSdk.mockReturnValue({ listings: { show: mockListingsShow } });
    resetReportedSpecialHandlingMalformed();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SPECIAL_HANDLING_FEE;
    } else {
      process.env.SPECIAL_HANDLING_FEE = originalEnv;
    }
  });

  const listingWithSpecialCare = flags => ({
    id: { uuid: 'listing-1' },
    attributes: { privateData: { specialCare: { flags } } },
  });

  const mockFreshListing = privateData =>
    mockListingsShow.mockResolvedValue({
      data: { data: { attributes: { privateData } } },
    });

  it('charges the $15 default when the listing has any Special Care flag set', async () => {
    mockFreshListing({ specialCare: { flags: ['highValue'] } });

    expect(
      await resolveSpecialHandlingFeeInSubunits(listingWithSpecialCare(['highValue']), 'USD')
    ).toBe(1500);
  });

  it('charges nothing when the listing has no Special Care flags', async () => {
    mockFreshListing({});

    expect(await resolveSpecialHandlingFeeInSubunits(listingWithSpecialCare([]), 'USD')).toBe(0);
  });

  it('charges nothing when the listing has no privateData at all', async () => {
    mockFreshListing(undefined);

    expect(await resolveSpecialHandlingFeeInSubunits(listingWithSpecialCare([]), 'USD')).toBe(0);
  });

  it('does not matter WHICH flag is set — it is a flat, not per-flag, fee', async () => {
    mockFreshListing({ specialCare: { flags: ['embellishments', 'leatherSuedeTrim'] } });

    expect(
      await resolveSpecialHandlingFeeInSubunits(
        listingWithSpecialCare(['embellishments', 'leatherSuedeTrim']),
        'USD'
      )
    ).toBe(1500);
  });

  it('uses the env override, including a $0 override that disables the fee outright', async () => {
    process.env.SPECIAL_HANDLING_FEE = '25';
    mockFreshListing({ specialCare: { flags: ['highValue'] } });
    expect(
      await resolveSpecialHandlingFeeInSubunits(listingWithSpecialCare(['highValue']), 'USD')
    ).toBe(2500);

    process.env.SPECIAL_HANDLING_FEE = '0';
    expect(
      await resolveSpecialHandlingFeeInSubunits(listingWithSpecialCare(['highValue']), 'USD')
    ).toBe(0);
  });

  // ── PREVIEW AND CHARGE AGREE BY CONSTRUCTION ───────────────────────────────
  // The whole point of re-fetching rather than trusting the passed-in listing: a
  // customer's own session SDK never carries privateData for someone else's listing, so
  // if this read the object it was handed instead of a fresh Integration API fetch, the
  // fee would silently be 0 on every real checkout while still working in a test that
  // hands it privateData directly.

  it('re-fetches the listing rather than trusting privateData already on the object it was given', async () => {
    mockFreshListing({ specialCare: { flags: ['highValue'] } });

    // The listing passed in claims no privateData at all — exactly what a customer's own
    // session SDK would hand this function on a real checkout.
    const listingFromCustomerSession = { id: { uuid: 'listing-1' }, attributes: {} };

    expect(await resolveSpecialHandlingFeeInSubunits(listingFromCustomerSession, 'USD')).toBe(1500);
    expect(mockListingsShow).toHaveBeenCalledWith({ id: { uuid: 'listing-1' } });
  });

  it('never throws, whatever the listing looks like', async () => {
    expect(await resolveSpecialHandlingFeeInSubunits(undefined, 'USD')).toBe(0);
    expect(await resolveSpecialHandlingFeeInSubunits({}, 'USD')).toBe(0);
    expect(mockListingsShow).not.toHaveBeenCalled();
  });

  it('returns 0 when no currency is given, even with special care set', async () => {
    mockFreshListing({ specialCare: { flags: ['highValue'] } });

    expect(
      await resolveSpecialHandlingFeeInSubunits(listingWithSpecialCare(['highValue']), null)
    ).toBe(0);
  });
});
