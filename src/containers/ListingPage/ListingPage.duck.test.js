jest.mock('../../util/api', () => ({
  fetchListingInitialCleaning: jest.fn(),
  transactionLineItems: jest.fn(),
}));

// Mocked so the deliberate failure cases below do not print stack traces, and so the one
// thing this module does report can be asserted rather than assumed.
jest.mock('../../util/log', () => ({
  error: jest.fn(),
}));

import { fetchListingInitialCleaning } from '../../util/api';
import * as log from '../../util/log';
import { types as sdkTypes } from '../../util/sdkLoader';
import { createFakeDispatch, getDefaultConfiguration } from '../../util/testHelpers';

import reducer, {
  fetchInitialCleaningDaysThunk,
  loadData,
  setInitialValues,
} from './ListingPage.duck';

const { UUID } = sdkTypes;

// Cocloset: the live initial-cleaning lookup.
//
//   > "desde el momento de la carga de listingPage, se debe consultar las propiedades de la
//   >  laundry seleccionada para este listing para obtener los días que se necesiten para el
//   >  lavado siempre que onLaundry sea false"
//
// What this file is for: the lookup is a NON-ESSENTIAL enrichment of a page that must render
// without it. So the two things worth asserting are (a) that it is asked for at all, and only
// when it should be, and (b) that nothing it can do - a 429, an outage, a nonsense payload -
// can degrade into either a broken page or an absent booking block. Both are invisible to a
// component test: the page renders either way.

const LISTING_ID = 'listing-1';

const listingEntity = ({ metadata = {}, alias = 'default-booking/release-1' } = {}) => ({
  id: new UUID(LISTING_ID),
  type: 'listing',
  attributes: {
    state: 'published',
    availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
    publicData: { unitType: 'day', transactionProcessAlias: alias },
    metadata,
  },
});

const fakeSdk = listing => ({
  listings: { show: jest.fn(() => Promise.resolve({ data: { data: listing, included: [] } })) },
  reviews: { query: jest.fn(() => Promise.resolve({ data: { data: [], included: [] } })) },
  currentUser: { show: jest.fn(() => Promise.resolve({ data: { data: null } })) },
  timeslots: { query: jest.fn(() => Promise.resolve({ data: { data: [] } })) },
});

// Enough of the store for loadData and the current-user fetch it kicks off on the side.
const getState = () => ({
  auth: { isAuthenticated: false },
  user: { currentUser: null, currentUserShowError: null },
  ListingPage: { inquiryModalOpenForListingId: null },
});

const runLoadData = async listing => {
  const sdk = fakeSdk(listing);
  const dispatch = createFakeDispatch(getState, sdk);
  // `accessControl` is normally filled in by mergeConfig from the hosted asset; the raw
  // default configuration has no such key, and loadData dereferences it.
  const config = {
    ...getDefaultConfiguration(),
    accessControl: { marketplace: { private: false } },
  };
  await loadData({ id: LISTING_ID }, '', config)(dispatch, getState, sdk);
  // The lookup is fired without being awaited, so let the microtask queue drain.
  // (jsdom has no setImmediate.)
  await new Promise(resolve => setTimeout(resolve, 0));
  return { dispatch, sdk };
};

describe('the live initial-cleaning lookup is asked for at page load', () => {
  beforeEach(() => {
    fetchListingInitialCleaning.mockResolvedValue({ data: { initialCleaningDays: 3 } });
  });

  it('asks for the listing being viewed', async () => {
    await runLoadData(listingEntity());
    expect(fetchListingInitialCleaning).toHaveBeenCalledTimes(1);
    expect(fetchListingInitialCleaning).toHaveBeenCalledWith(LISTING_ID);
  });

  // The same condition that makes this rule first-time-only everywhere else. Without it, every
  // view of every garment in the marketplace after its first rental would cost a request here
  // and an Integration API read behind it, to be told there is no block.
  it('does not ask once the garment is at its laundry', async () => {
    await runLoadData(listingEntity({ metadata: { onLaundry: true } }));
    expect(fetchListingInitialCleaning).not.toHaveBeenCalled();
  });

  // `=== true` and not truthiness, matching the server gate and the calendar: bad data is not
  // custody, and must not switch the lookup off.
  it.each([['false', false], ['the string "true"', 'true'], ['1', 1]])(
    'still asks when onLaundry is %s',
    async (_label, onLaundry) => {
      await runLoadData(listingEntity({ metadata: { onLaundry } }));
      expect(fetchListingInitialCleaning).toHaveBeenCalledTimes(1);
    }
  );

  it('does not ask for a listing with no booking calendar to move', async () => {
    await runLoadData(listingEntity({ alias: 'default-inquiry/release-1' }));
    expect(fetchListingInitialCleaning).not.toHaveBeenCalled();
  });
});

describe('the lookup result reaches the state, and failure never removes the block', () => {
  const runThunk = async () => {
    const dispatch = createFakeDispatch(getState, {});
    return dispatch(fetchInitialCleaningDaysThunk({ listingId: new UUID(LISTING_ID) })).unwrap();
  };

  // THE PAYLOAD IS AN OBJECT NOW, not a bare number: the same endpoint call also brings the
  // cleaning gaps (the days another rental's wash has already claimed), because both answers
  // come from the same listing on the same page load and both feed the same picker. See
  // server/api-util/cleaningGaps.js.
  it('stores a usable number of days', async () => {
    fetchListingInitialCleaning.mockResolvedValue({ data: { initialCleaningDays: 4 } });
    await expect(runThunk()).resolves.toMatchObject({ initialCleaningDays: 4 });
  });

  // The endpoint answers `{ data: {} }` for "no block applies". That has to arrive as null, not
  // as undefined or NaN, because null is what the calendar reads as "use the snapshot".
  it('stores null when the endpoint reports no block', async () => {
    fetchListingInitialCleaning.mockResolvedValue({ data: {} });
    await expect(runThunk()).resolves.toEqual({ initialCleaningDays: null, cleaningGaps: null });
  });

  it.each([['a fraction', 2.5], ['zero', 0], ['negative', -1], ['a string', '3'], ['null', null]])(
    'stores null for the nonsense payload %s rather than passing it on',
    async (_label, initialCleaningDays) => {
      fetchListingInitialCleaning.mockResolvedValue({ data: { initialCleaningDays } });
      await expect(runThunk()).resolves.toMatchObject({ initialCleaningDays: null });
    }
  );

  // THE IMPORTANT ONE. The payload creator must not reject: a rejected thunk inside loadData
  // becomes a failed page load, and the whole point of resolving this live is that it is an
  // improvement on a working fallback, not a new dependency of the listing page.
  it('resolves null instead of rejecting when the request fails', async () => {
    fetchListingInitialCleaning.mockRejectedValue(
      Object.assign(new Error('too many requests'), { status: 429 })
    );
    await expect(runThunk()).resolves.toEqual({ initialCleaningDays: null, cleaningGaps: null });
  });

  // Silent to the customer, not silent to us: a laundry whose profile has become
  // unreadable is a real problem that the snapshot fallback would otherwise hide forever.
  it('logs the failure it swallows', async () => {
    fetchListingInitialCleaning.mockRejectedValue(new Error('offline'));
    await runThunk();
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Error),
      'fetching-live-initial-cleaning-days-failed',
      {
        listingId: LISTING_ID,
      }
    );
  });

  it('does not fail the page load when the request fails', async () => {
    fetchListingInitialCleaning.mockRejectedValue(new Error('offline'));
    await expect(runLoadData(listingEntity())).resolves.toBeDefined();
  });

  it('puts the resolved value in the slice', async () => {
    const state = reducer(undefined, {
      type: fetchInitialCleaningDaysThunk.fulfilled.type,
      payload: { initialCleaningDays: 5, cleaningGaps: [] },
    });
    expect(state.initialCleaningDays).toBe(5);
    expect(state.cleaningGaps).toEqual([]);
  });

  // "Not known" and "asked, and there are none" have to stay structurally different: the
  // picker blocks nothing for null, which is the safe answer while a page load is still in
  // flight, and would be the WRONG answer to read out of an empty list.
  it('keeps an unknown gap list distinct from an empty one', () => {
    const unknown = reducer(undefined, {
      type: fetchInitialCleaningDaysThunk.fulfilled.type,
      payload: { initialCleaningDays: null, cleaningGaps: null },
    });
    expect(unknown.cleaningGaps).toBeNull();
    expect(reducer(undefined, { type: 'noop' }).cleaningGaps).toBeNull();
  });

  it('starts out null, so the calendar uses the snapshot until an answer arrives', () => {
    expect(reducer(undefined, { type: 'noop' }).initialCleaningDays).toBeNull();
  });

  // Navigating from one listing to another must not leave the previous garment's floor in
  // place - it would silently block dates on a listing it has nothing to do with.
  it('is cleared by setInitialValues, which loadData calls on every navigation', () => {
    const withValue = reducer(undefined, {
      type: fetchInitialCleaningDaysThunk.fulfilled.type,
      payload: { initialCleaningDays: 5, cleaningGaps: [] },
    });
    const cleared = reducer(withValue, setInitialValues({ lineItems: null }));
    expect(cleared.initialCleaningDays).toBeNull();
    expect(cleared.cleaningGaps).toBeNull();
  });
});
