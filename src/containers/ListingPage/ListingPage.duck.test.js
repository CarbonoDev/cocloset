jest.mock('../../util/api', () => ({
  fetchListingInitialCleaning: jest.fn(),
  // The stale-block cleanup, fired and forgotten on every listing view - see loadData.
  sweepListingAvailability: jest.fn(() => Promise.resolve({ data: {} })),
  transactionLineItems: jest.fn(),
}));

// Mocked so the deliberate failure cases below do not print stack traces, and so the one
// thing this module does report can be asserted rather than assumed.
jest.mock('../../util/log', () => ({
  error: jest.fn(),
}));

import { fetchListingInitialCleaning, sweepListingAvailability } from '../../util/api';
import * as log from '../../util/log';
import { types as sdkTypes } from '../../util/sdkLoader';
import { createFakeDispatch, getDefaultConfiguration } from '../../util/testHelpers';

import reducer, {
  fetchAssignedLaundryHoursThunk,
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

const ASSIGNED_LAUNDRY_ID = '9a1b2c3d-0000-0000-0000-0000000000aa';

// Assigned to a studio by default: that is what decides whether this page has anything to
// fetch. Custody (`onLaundry`) used to decide it, which is the bug the tests below now pin.
const listingEntity = ({
  metadata = {},
  alias = 'default-booking/release-1',
  assignedLaundryId = ASSIGNED_LAUNDRY_ID,
} = {}) => ({
  id: new UUID(LISTING_ID),
  type: 'listing',
  attributes: {
    state: 'published',
    availabilityPlan: { type: 'availability-plan/time', timezone: 'Etc/UTC' },
    publicData: { unitType: 'day', transactionProcessAlias: alias },
    metadata: { ...(assignedLaundryId ? { assignedLaundryId } : {}), ...metadata },
  },
});

// A studio user as the Marketplace API returns it: the opening hours live in the PUBLIC half
// of its profile, which is what makes them readable by an anonymous browser (see
// fetchAssignedLaundryHoursThunk) rather than needing a server endpoint like the turnaround.
const laundryUserEntity = (businessHoursByDay = { mon: { open: '09:00', close: '18:00' } }) => ({
  id: new UUID(ASSIGNED_LAUNDRY_ID),
  type: 'user',
  attributes: {
    profile: {
      displayName: 'Triple A Cleaners',
      publicData: { laundryProfile: { studioName: 'Triple A Cleaners', businessHoursByDay } },
    },
  },
});

const fakeSdk = (listing, laundryUser = laundryUserEntity()) => ({
  listings: { show: jest.fn(() => Promise.resolve({ data: { data: listing, included: [] } })) },
  reviews: { query: jest.fn(() => Promise.resolve({ data: { data: [], included: [] } })) },
  currentUser: { show: jest.fn(() => Promise.resolve({ data: { data: null } })) },
  timeslots: { query: jest.fn(() => Promise.resolve({ data: { data: [] } })) },
  users: { show: jest.fn(() => Promise.resolve({ data: { data: laundryUser } })) },
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
    sweepListingAvailability.mockResolvedValue({ data: {} });
  });

  // -------------------------------------------------------------------------
  //   > "habia hecho una reservación (...) y la cancelé como operator, por lo tanto, los días
  //   >  reservados deberían estar disponibles, sin embargo no lo estan" (Jonathan, 2026-09-07)
  //
  // Accepting a booking blocks its window and nothing ever unblocked it. A cancellation made
  // from Console runs no code of ours, so the cleanup is triggered by this read - which makes
  // the WIRING the whole feature. A sweep endpoint nobody calls is indistinguishable from the
  // bug, and on this project that is exactly where things have died before.
  // -------------------------------------------------------------------------
  it('asks for the stale blocks to be swept', async () => {
    await runLoadData(listingEntity());

    expect(sweepListingAvailability).toHaveBeenCalledWith(LISTING_ID);
  });

  it('does not fail the page load when the sweep fails', async () => {
    // It is a cleanup nobody is waiting on. A listing page that will not render is a much
    // bigger wrong than a calendar that frees its days on the next load instead of this one.
    sweepListingAvailability.mockRejectedValue(new Error('boom'));

    await expect(runLoadData(listingEntity())).resolves.toBeDefined();
  });

  it('does not fail the page load when the sweep throws synchronously', async () => {
    // A throw before any promise exists escapes into loadData unless it is wrapped.
    sweepListingAvailability.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(runLoadData(listingEntity())).resolves.toBeDefined();
  });

  it('asks for the listing being viewed', async () => {
    await runLoadData(listingEntity());
    expect(fetchListingInitialCleaning).toHaveBeenCalledTimes(1);
    expect(fetchListingInitialCleaning).toHaveBeenCalledWith(LISTING_ID);
  });

  // THE REGRESSION THIS PINS. The call used to be skipped once `onLaundry === true`, which
  // was right when it answered only the INITIAL cleaning lead time - a rule that is spent by
  // then. It now also carries the days blocked by the wash owed after each booking, which are
  // not first-time-only, so skipping it meant a garment's calendar stopped hearing about
  // cleaning days the moment it had been to a laundry once. That is every garment after its
  // first rental, and it was reproduced against Dev on four of seven listings.
  it('STILL asks once the garment is at its laundry', async () => {
    await runLoadData(listingEntity({ metadata: { onLaundry: true } }));
    expect(fetchListingInitialCleaning).toHaveBeenCalledTimes(1);
  });

  it.each([['false', false], ['the string "true"', 'true'], ['1', 1], ['true', true]])(
    'asks whatever onLaundry says (%s), because custody no longer decides',
    async (_label, onLaundry) => {
      await runLoadData(listingEntity({ metadata: { onLaundry } }));
      expect(fetchListingInitialCleaning).toHaveBeenCalledTimes(1);
    }
  );

  // What DOES decide: a studio to ask about. With none assigned there is no turnaround, no
  // lead time and no gaps - the answer is known without a request.
  it('does not ask when no laundry is assigned', async () => {
    await runLoadData(listingEntity({ assignedLaundryId: null }));
    expect(fetchListingInitialCleaning).not.toHaveBeenCalled();
  });

  it('does not ask for a listing with no booking calendar to move', async () => {
    await runLoadData(listingEntity({ alias: 'default-inquiry/release-1' }));
    expect(fetchListingInitialCleaning).not.toHaveBeenCalled();
  });
});

// THE AVAILABILITY FETCH HAS TO INCLUDE TODAY.
//
//   > "aun el problema persiste (...) el día de hoy esté habilitado para seleccionarlo y que la
//   >  fecha de reserva sea hoy" (Jonathan, 2026-09-28)
//
// THIS is where "today is not bookable" actually lived, and it is the reason two previous
// attempts at it changed nothing. The range started at `findNextBoundary(now, 1, 'day')` -
// TOMORROW's midnight - so availability for today never reached the browser at all, and every
// surface built on it concluded today was taken: the picker disabled the day, the five-week
// strip labelled it "No longer available". Both were reading data that did not describe today.
//
// `/timeslots/query` returns availability from wherever the query starts (verified against Dev:
// asking from today's midnight returns a slot starting at today's midnight; asking from
// yesterday's returns one starting yesterday), and Sharetribe accepts a booking that starts at
// today's midnight. So this one boundary is the fix, and this test is what keeps it.
describe('the availability fetch range', () => {
  beforeEach(() => {
    fetchListingInitialCleaning.mockResolvedValue({ data: {} });
    sweepListingAvailability.mockResolvedValue({ data: {} });
  });

  const startOfTodayUtc = () => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  };

  it('starts at the start of today for a whole-day listing, not at tomorrow', async () => {
    const { sdk } = await runLoadData(listingEntity());

    // The first of the two monthly queries is the one covering today.
    const firstStart = sdk.timeslots.query.mock.calls[0][0].start;
    expect(firstStart.toISOString()).toBe(startOfTodayUtc().toISOString());
  });

  it('still asks for a range that ends where it did', async () => {
    // Only the start moved. A changed end would silently change how far ahead the calendar
    // reaches, which is a different feature.
    const { sdk } = await runLoadData(listingEntity());
    const { start, end } = sdk.timeslots.query.mock.calls[0][0];

    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.toISOString()).toBe(
      new Date(Date.UTC(startOfTodayUtc().getUTCFullYear(), startOfTodayUtc().getUTCMonth() + 1, 1))
        .toISOString()
    );
  });
});

// THE STUDIO'S OPENING HOURS, for the pickup card.
//
//   > "se puede reservar aunque laundry haya cerrado, solo aseguremonos que se muestren los
//   >  horarios de la laundry" (Jonathan, 2026-09-28)
//
// Same contract as the lookup above and worth pinning for the same reason: it enriches a page
// that has to render without it. What is different is where the data comes from - the studio's
// PUBLIC profile, read with the browser's own session, so there is no endpoint and no
// privateData anywhere near it.
describe('the assigned studio opening hours lookup', () => {
  beforeEach(() => {
    fetchListingInitialCleaning.mockResolvedValue({ data: {} });
    sweepListingAvailability.mockResolvedValue({ data: {} });
  });

  it('reads the studio named in the listing metadata', async () => {
    const { sdk } = await runLoadData(listingEntity());

    expect(sdk.users.show).toHaveBeenCalledTimes(1);
    expect(sdk.users.show.mock.calls[0][0].id.uuid).toBe(ASSIGNED_LAUNDRY_ID);
  });

  it('does not ask when no studio is assigned', async () => {
    // Nothing to name and nothing to open. Same gate as the turnaround lookup.
    const { sdk } = await runLoadData(listingEntity({ assignedLaundryId: null }));

    expect(sdk.users.show).not.toHaveBeenCalled();
  });

  it('puts the hours in the state', async () => {
    const hours = { mon: { open: '10:00', close: '20:00' }, sat: { open: '11:00', close: '15:00' } };
    const sdk = fakeSdk(listingEntity(), laundryUserEntity(hours));
    const dispatch = createFakeDispatch(getState, sdk);

    const result = await dispatch(
      fetchAssignedLaundryHoursThunk({ laundryId: ASSIGNED_LAUNDRY_ID })
    ).unwrap();

    expect(result.assignedLaundryHours).toEqual(hours);
  });

  it('reports no hours rather than an empty object for a studio that has never saved the grid', async () => {
    // Such a studio has only the old free-text summary, which is a sentence and not something
    // the card can render as rows. Absent is the honest answer; `{}` would make the label
    // appear above nothing. See util/businessHours.js on the two fields.
    const sdk = fakeSdk(listingEntity(), laundryUserEntity({}));
    const dispatch = createFakeDispatch(getState, sdk);

    const result = await dispatch(
      fetchAssignedLaundryHoursThunk({ laundryId: ASSIGNED_LAUNDRY_ID })
    ).unwrap();

    expect(result.assignedLaundryHours).toBeNull();
  });

  it('never fails the page, and reports nothing, when the studio cannot be read', async () => {
    const sdk = fakeSdk(listingEntity());
    sdk.users.show.mockRejectedValue(new Error('boom'));
    const dispatch = createFakeDispatch(getState, sdk);

    const result = await dispatch(
      fetchAssignedLaundryHoursThunk({ laundryId: ASSIGNED_LAUNDRY_ID })
    ).unwrap();

    expect(result.assignedLaundryHours).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('does not fail the page load when the studio read fails', async () => {
    const sdk = fakeSdk(listingEntity());
    sdk.users.show.mockRejectedValue(new Error('boom'));
    const dispatch = createFakeDispatch(getState, sdk);
    const config = {
      ...getDefaultConfiguration(),
      accessControl: { marketplace: { private: false } },
    };

    await expect(
      loadData({ id: LISTING_ID }, '', config)(dispatch, getState, sdk)
    ).resolves.toBeDefined();
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
    await expect(runThunk()).resolves.toEqual({
      initialCleaningDays: null,
      cleaningGaps: null,
      cleaningTurnaroundDays: null,
      completedRentals: null,
    });
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
    await expect(runThunk()).resolves.toEqual({
      initialCleaningDays: null,
      cleaningGaps: null,
      cleaningTurnaroundDays: null,
      completedRentals: null,
    });
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
