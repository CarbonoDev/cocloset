jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/listingOwnerAuth', () => ({
  requireListingAuthorCaller: jest.fn(),
}));

// The §3.12 New Incoming Garment notification, mocked the way
// laundry-transaction-status.test.js mocks the mailer it fires: these tests are
// about WHETHER and WITH WHAT the endpoint sends, not about composing a body or
// about Mailgun. Mocking it also keeps the real (unconfigured) skip log out of
// this suite's output.
jest.mock('../api-util/laundryMailer', () => ({
  notifyNewIncomingGarment: jest.fn(() => Promise.resolve({ sent: false, reason: 'mocked' })),
}));

jest.mock('../log', () => ({ error: jest.fn(), devLogger: jest.fn() }));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');
const { notifyNewIncomingGarment } = require('../api-util/laundryMailer');
const { ACTIVE_LAST_TRANSITIONS } = require('../api-util/coclosetBookingProcess');

const { resolveInitialCleaningDays } = require('../api-util/laundryAssignment');
const { HARDCODED_DEFAULT_BUFFER_DAYS } = require('../api-util/availabilityHelpers');

const listingLaundryAssignment = require('./listing-laundry-assignment');
const { evaluateLaundryAssignment } = listingLaundryAssignment;

const LISTING_ID = { uuid: 'listing-1' };
const OWNER_ID = 'owner-1';
const LAUNDRY_A = 'laundry-a';
const LAUNDRY_B = 'laundry-b';

const mockRes = () => ({
  statusCode: null,
  body: null,
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn().mockReturnThis(),
  send: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  json: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  end: jest.fn().mockReturnThis(),
});

// The assignment lives in `metadata` now. That is not a cosmetic move: the
// Marketplace API refuses an owner's `ownListings.update({ metadata })` outright
// (400 `validation-disallowed-key`, verified against Dev), which is what makes
// this endpoint the only way in and therefore makes the rule below enforceable.
const listingEntity = ({ assignedLaundryId = LAUNDRY_A, metadata = {} } = {}) => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: {
    publicData: { categoryLevel1: 'dresses' },
    metadata: { assignedLaundryId, ...metadata },
  },
  relationships: { author: { data: { id: { uuid: OWNER_ID }, type: 'user' } } },
});

// A user who genuinely passes `isLaundryUserEntity` and has a usable profile, so
// api-util/laundryDirectory.js's mapping yields an address and an origin.
const laundryUserEntity = ({
  id = LAUNDRY_B,
  isLaundry = true,
  profile = {},
  email = 'studio@marais.example.com',
} = {}) => ({
  id: { uuid: id },
  type: 'user',
  attributes: {
    // The account email, which only the Integration API exposes for a third
    // party. It is what the New Incoming Garment notification is addressed to.
    email,
    profile: {
      displayName: 'Maison du Marais',
      metadata: { isLaundry },
      publicData: {
        laundryProfile: {
          studioName: 'Maison du Marais',
          address: '5 Rue des Rosiers, Paris',
          origin: { lat: 48.857, lng: 2.359 },
        },
      },
      privateData: {},
      ...profile,
    },
  },
});

// api-util/listingCustody.js's findActiveTransactions is deliberately NOT mocked,
// so these tests exercise its real query and its real fail-closed behaviour
// rather than a stand-in for them.
// The author rides in `included`, which is why the endpoint asks for
// `include: ['author']` (see api-util/listingOwnerAuth.js). Its display name is
// the only thing the New Incoming Garment notification needs from it.
const authorEntity = (displayName = 'Amélie Rousseau') => ({
  id: { uuid: OWNER_ID },
  type: 'user',
  attributes: { profile: { displayName } },
});

const setupSdk = (
  listing,
  { transactions = [], transactionsReject, laundry, included = [authorEntity()] } = {}
) => {
  const show = jest.fn(() => Promise.resolve({ data: { data: listing, included } }));
  const update = jest.fn(() => Promise.resolve({ data: { data: listing } }));
  const transactionsQuery = jest.fn(() =>
    transactionsReject
      ? Promise.reject(new Error('Integration API unavailable'))
      : Promise.resolve({ data: { data: transactions } })
  );
  const usersShow = jest.fn(() =>
    Promise.resolve({ data: { data: laundry === undefined ? laundryUserEntity() : laundry } })
  );

  const sdk = {
    listings: { show, update },
    transactions: { query: transactionsQuery },
    users: { show: usersShow },
  };
  getIntegrationSdk.mockReturnValue(sdk);
  return { sdk, show, update, transactionsQuery, usersShow };
};

const activeTransaction = (lastTransition = 'transition/accept') => ({
  id: { uuid: 'tx-1' },
  type: 'transaction',
  attributes: { lastTransition },
});

const run = async (body, res = mockRes()) => {
  await listingLaundryAssignment({ body }, res);
  await new Promise(setImmediate);
  return res;
};

// ---------------------------------------------------------------------------
// The rule, in isolation.
//
// This is the half of the guard that has to be right. It fails in the dangerous
// direction by ALLOWING a change, and an allowed change silently transfers
// authority over an in-flight custody chain from the studio physically holding
// the garment to a studio that has never seen it - including the authority to
// fire `laundry-mark-pending-cleaning`, which pays the provider out.
//
// Two conditions, per the client:
//
//   > "se puede editar la laundry mientras que no este en una transaction activa
//   >  y que onLaundry sea false"
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The initial cleaning turnaround, snapshotted onto the listing at assignment.
//
// This number is what stops the booking calendar offering TOMORROW for a garment
// that has never physically reached a studio:
//
//   > "Al hacer booking, el calendario muestra el siguiente día como disponible,
//   >  pero no esta considerando los tiempos de lavado inicial"
//
// It has to agree with the turnaround create-availability-buffer.js uses to size
// the block window around an accepted booking, so the resolution chain is REUSED
// rather than restated. These tests pin the chain, including the fallbacks, because
// this is the only moment the value is ever computed - it is then stored, and a
// wrong number sits on the listing indefinitely.
// ---------------------------------------------------------------------------

describe('resolveInitialCleaningDays', () => {
  const resolve = (laundryPrivateData, listingPublicData, envDefaultBufferDays) =>
    resolveInitialCleaningDays({ laundryPrivateData, listingPublicData, envDefaultBufferDays });

  it('prefers the turnaround the laundry set for THIS garment top-level category', () => {
    expect(
      resolve(
        { turnaroundDays: 2, categoryPricing: { dresses: { turnaroundDays: 5 } } },
        { categoryLevel1: 'dresses', categoryLevel2: 'midi_dress' }
      )
    ).toBe(5);
  });

  it('falls back to the studio-wide turnaround when the category has none', () => {
    expect(
      resolve(
        { turnaroundDays: 2, categoryPricing: { tops: { turnaroundDays: 5 } } },
        {
          categoryLevel1: 'dresses',
        }
      )
    ).toBe(2);
  });

  it('falls back to the env default, then to the hardcoded default', () => {
    expect(resolve({}, { categoryLevel1: 'dresses' }, '4')).toBe(4);
    expect(resolve({}, { categoryLevel1: 'dresses' })).toBe(HARDCODED_DEFAULT_BUFFER_DAYS);
    expect(HARDCODED_DEFAULT_BUFFER_DAYS).toBe(2);
  });

  // Rounded UP, through the same computeBufferDays rule the buffer window uses.
  // Under-blocking means offering a customer a garment that is still in the wash.
  it('rounds a fractional turnaround up to a whole day', () => {
    expect(resolve({ turnaroundDays: 1.5 }, {})).toBe(2);
    expect(resolve({}, {}, '2.1')).toBe(3);
  });

  it('never returns zero or a non-integer, whatever the stored data looks like', () => {
    // Every one of these has to end up as a usable positive integer: the value is
    // written straight into metadata, and resolveInitialCleaningBlockDays treats a
    // malformed one as NO BLOCK - i.e. a bad write here silently disables the rule.
    [
      undefined,
      null,
      {},
      { turnaroundDays: 0 },
      { turnaroundDays: -3 },
      { turnaroundDays: 'x' },
      {
        categoryPricing: [],
      },
    ].forEach(privateData => {
      const days = resolveInitialCleaningDays({
        laundryPrivateData: privateData,
        listingPublicData: { categoryLevel1: 'dresses' },
      });
      expect(Number.isInteger(days)).toBe(true);
      expect(days).toBeGreaterThan(0);
    });
  });

  it('does not need a category chain at all', () => {
    // A listing whose category was never set still gets a usable number rather than
    // NaN: getListingCategoryValues returns [] and resolution starts studio-wide.
    expect(resolve({ turnaroundDays: 3 }, undefined)).toBe(3);
    expect(resolve({ turnaroundDays: 3 }, {})).toBe(3);
  });
});

describe('evaluateLaundryAssignment', () => {
  it('allows a first assignment (no laundry yet, no custody)', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: undefined,
        nextAssignedLaundryId: LAUNDRY_A,
        onLaundry: undefined,
      })
    ).toEqual({ allowed: true, changed: true, reason: null });
  });

  it('allows a change while the garment is with its owner', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        onLaundry: false,
      })
    ).toEqual({ allowed: true, changed: true, reason: null });
  });

  it('REFUSES a change while the garment is at the laundry', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        onLaundry: true,
      })
    ).toEqual({ allowed: false, changed: true, reason: 'on-laundry' });
  });

  it('REFUSES a change while the listing has an active transaction', () => {
    // The second condition, and NOT redundant with the first: a transaction can
    // be active (`accepted`) with the garment still at home, which is exactly the
    // window in which a reassignment would hand a new studio a rental it has never
    // touched.
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        onLaundry: false,
        hasActiveTransaction: true,
      })
    ).toEqual({ allowed: false, changed: true, reason: 'active-transaction' });
  });

  it('requires BOTH conditions, so neither alone is sufficient', () => {
    // The table the rule has to satisfy. Written out because "and" is the entire
    // content of the rule, and an accidental "or" would read identically at a
    // glance while opening a real reassignment window on every row but the last.
    const change = extra =>
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        ...extra,
      }).allowed;

    expect(change({ onLaundry: true, hasActiveTransaction: true })).toBe(false);
    expect(change({ onLaundry: true, hasActiveTransaction: false })).toBe(false);
    expect(change({ onLaundry: false, hasActiveTransaction: true })).toBe(false);
    expect(change({ onLaundry: false, hasActiveTransaction: false })).toBe(true);
  });

  it('allows re-saving the SAME laundry while the garment is at the laundry', () => {
    // The wizard's LAUNDRY tab is re-submitted whenever an owner walks back
    // through it. Refusing a no-op would make the tab impassable rather than
    // making the assignment immutable.
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_A,
        onLaundry: true,
      })
    ).toEqual({ allowed: true, changed: false, reason: null });
  });

  it('allows re-saving the SAME laundry mid-rental', () => {
    // Dev has a listing sitting at `picked-up` right now. Gating a no-op would
    // dead-end its owner's wizard: they save, are redirected forward, are bounced
    // straight back, and are never told why.
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_A,
        onLaundry: true,
        hasActiveTransaction: true,
      })
    ).toEqual({ allowed: true, changed: false, reason: null });
  });

  it('treats a missing onLaundry as "with its owner"', () => {
    // Every listing predating this field. The flag is only ever set true by an
    // event that physically happened, so absence genuinely means no laundry has
    // reported holding this garment.
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        onLaundry: undefined,
      })
    ).toMatchObject({ allowed: true });
  });

  // The trap: `if (onLaundry)` would lock the picker on any truthy junk, and
  // `if (onLaundry != false)` would lock it on absence. Only a real boolean true
  // means the garment is in a studio - anything else is bad data, and bad data
  // must not be able to freeze an owner's listing forever.
  it.each([['the string "true"', 'true'], ['1', 1], ['an object', {}], ['null', null]])(
    'does not lock on %s',
    (_label, onLaundry) => {
      expect(
        evaluateLaundryAssignment({
          currentAssignedLaundryId: LAUNDRY_A,
          nextAssignedLaundryId: LAUNDRY_B,
          onLaundry,
        })
      ).toMatchObject({ allowed: true });
    }
  );

  // The same trap on the other condition. `hasActiveTransaction` comes from
  // findActiveTransactions, which returns a real boolean - but it crosses a module
  // boundary, and a truthy check here would let a future caller freeze a listing
  // forever by passing a non-empty array or a string.
  it.each([['the string "true"', 'true'], ['1', 1], ['an array', []], ['null', null]])(
    'does not block on a non-boolean hasActiveTransaction: %s',
    (_label, hasActiveTransaction) => {
      expect(
        evaluateLaundryAssignment({
          currentAssignedLaundryId: LAUNDRY_A,
          nextAssignedLaundryId: LAUNDRY_B,
          onLaundry: false,
          hasActiveTransaction,
        })
      ).toMatchObject({ allowed: true });
    }
  );

  it('normalises absent vs empty so an unset laundry is not a "change" to itself', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: null,
        nextAssignedLaundryId: null,
        onLaundry: true,
      })
    ).toEqual({ allowed: true, changed: false, reason: null });
  });

  it('names the on-laundry condition first when both refuse', () => {
    // Mid-rental both are usually true at once, and "the garment is at the studio"
    // is the more specific and more actionable of the two for an owner.
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        onLaundry: true,
        hasActiveTransaction: true,
      }).reason
    ).toBe('on-laundry');
  });
});

describe('listing-laundry-assignment', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    requireListingAuthorCaller.mockResolvedValue({ id: { uuid: OWNER_ID } });
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error', data: e.data });
      res.end();
    });
  });

  describe('request validation', () => {
    it('rejects a missing listingId', async () => {
      setupSdk(listingEntity());
      const res = await run({ assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a missing or non-string assignedLaundryId', async () => {
      setupSdk(listingEntity());
      expect((await run({ listingId: LISTING_ID })).statusCode).toBe(400);
      expect((await run({ listingId: LISTING_ID, assignedLaundryId: 7 })).statusCode).toBe(400);
    });
  });

  describe('authorization', () => {
    const forbid = () => {
      const error = new Error('Caller is not the owner of this listing.');
      error.status = 403;
      error.statusText = 'Caller is not the owner of this listing.';
      error.data = {};
      requireListingAuthorCaller.mockRejectedValue(error);
    };

    it('answers 403 for a caller who is not the listing owner', async () => {
      setupSdk(listingEntity());
      forbid();

      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(403);
    });

    it('does not accept the assigned laundry as a substitute for the owner', async () => {
      // Choosing who cleans a garment is the owner's decision, and a studio has an
      // obvious interest in the answer.
      setupSdk(listingEntity());
      forbid();

      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(403);
    });

    it('authorizes against the fetched listing', async () => {
      const listing = listingEntity();
      setupSdk(listing);
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(requireListingAuthorCaller).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        listing
      );
    });

    // `requireListingAuthorCaller` is mocked in this suite, so nothing here can
    // catch it being handed a listing with no author to check - and that is
    // exactly the bug that shipped: the fetch omitted `include: ['author']`, the
    // real API returned no `relationships` at all, and every owner was told
    // "Caller is not the owner of this listing." while assigning their own
    // garment. The unit tests passed throughout, because their fixtures were more
    // generous than the API.
    //
    // So this asserts the FETCH, not the decision. It is the only place in this
    // suite that can.
    it("fetches the listing with include: ['author'] - the ownership check is unanswerable without it", async () => {
      const { show } = setupSdk(listingEntity());
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(show).toHaveBeenCalledWith(expect.objectContaining({ include: ['author'] }));
    });

    it('writes nothing at all when authorization fails', async () => {
      // Now that this endpoint IS the writer, "answers 403" and "wrote nothing" are
      // two separate claims, and only the second one protects anything.
      const { update } = setupSdk(listingEntity());
      forbid();

      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(update).not.toHaveBeenCalled();
    });

    it('does not reveal whether the target is a laundry to an unauthorized caller', async () => {
      // Authorization runs before the laundry lookup, so this endpoint cannot be
      // used to enumerate which users carry the isLaundry flag.
      const { usersShow } = setupSdk(listingEntity());
      forbid();

      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(usersShow).not.toHaveBeenCalled();
    });
  });

  describe('the guard', () => {
    it('allows a change while the garment is home and nothing is booked', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({ allowed: true, changed: true, onLaundry: false });
    });

    it('refuses a change with 409 while the garment is at the laundry', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(409);
    });

    it('refuses a change with 409 while the listing has an active transaction', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        transactions: [activeTransaction()],
      });
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(409);
    });

    it('writes nothing when either condition refuses', async () => {
      const onLaundry = setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(onLaundry.update).not.toHaveBeenCalled();

      const active = setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        transactions: [activeTransaction()],
      });
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(active.update).not.toHaveBeenCalled();
    });

    it('names the reason in the 409, so the wizard can say which condition it was', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      const onLaundryRes = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(onLaundryRes.body.error).toMatch(/at the laundry/i);
      expect(onLaundryRes.body.data).toMatchObject({ reason: 'on-laundry' });

      setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        transactions: [activeTransaction()],
      });
      const activeRes = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(activeRes.body.error).toMatch(/active transaction/i);
      expect(activeRes.body.data).toMatchObject({ reason: 'active-transaction' });
    });

    it('FAILS CLOSED when the transaction query itself fails', async () => {
      // Reused from api-util/listingCustody.js on purpose. Answering "no active
      // transaction" on an Integration API hiccup would turn every network blip
      // into permission to reassign a garment that is out on rental.
      setupSdk(listingEntity({ metadata: { onLaundry: false } }), { transactionsReject: true });
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/could not verify/i);
    });

    it('asks about active transactions using the DERIVED transition list', async () => {
      // Not a hand-typed list: ACTIVE_LAST_TRANSITIONS is derived from the process
      // transcription, because `lastTransitions` matches NOTHING for an
      // unrecognised name rather than erroring - so a typo would make an active
      // transaction invisible and let a garment be reassigned mid-rental.
      const { transactionsQuery } = setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(transactionsQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          listingId: LISTING_ID.uuid,
          lastTransitions: ACTIVE_LAST_TRANSITIONS,
        })
      );
    });

    it('allows re-saving the same laundry while the garment is at the laundry', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_A });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({ allowed: true, changed: false, onLaundry: true });
    });

    it('does not even ask about transactions on a no-op re-save', async () => {
      // findActiveTransactions fails closed, so asking on a no-op would let a
      // transient Integration API fault dead-end the wizard tab for an owner who
      // was not changing anything.
      const { transactionsQuery } = setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_A });
      expect(transactionsQuery).not.toHaveBeenCalled();
    });

    it('reads onLaundry from the API, never from the request body', async () => {
      // The client could otherwise simply assert that the garment is home. This is
      // the single reason the check is worth making server-side at all.
      setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      const res = await run({
        listingId: LISTING_ID,
        assignedLaundryId: LAUNDRY_B,
        onLaundry: false,
      });
      expect(res.statusCode).toBe(409);
    });

    it('reads the CURRENT laundry from the API, never from the request body', async () => {
      // The other half of the same bypass, and the subtler one. A body-supplied
      // current id equal to the new one would make a real change look like a no-op
      // re-save - which skips BOTH conditions, so this single field would defeat
      // the whole guard rather than half of it.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      const res = await run({
        listingId: LISTING_ID,
        assignedLaundryId: LAUNDRY_B,
        currentAssignedLaundryId: LAUNDRY_B,
        changed: false,
      });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });

    it('cannot be talked out of the active-transaction check by the body either', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        transactions: [activeTransaction()],
      });
      const res = await run({
        listingId: LISTING_ID,
        assignedLaundryId: LAUNDRY_B,
        hasActiveTransaction: false,
        allowed: true,
      });
      expect(res.statusCode).toBe(409);
    });

    it('allows a first assignment on a listing that has never had one', async () => {
      setupSdk(listingEntity({ assignedLaundryId: null, metadata: {} }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_A });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({ changed: true, currentAssignedLaundryId: null });
    });

    it('ignores a stale publicData.assignedLaundryId when deciding what changed', async () => {
      // An unmigrated listing, or one whose old owner-writable copy survived.
      // Treating that copy as the current value would let an owner forge a no-op:
      // point publicData at the laundry they want, and the change looks like a
      // re-save - which skips both conditions.
      const listing = listingEntity({ metadata: { onLaundry: true } });
      listing.attributes.publicData.assignedLaundryId = LAUNDRY_B;
      setupSdk(listing);

      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('the write', () => {
    it('IS the writer, via the Integration API', async () => {
      // This endpoint used to be a decision only, and its old test asserted that
      // `sdk.listings.update` did not even exist - because the browser did the
      // write, and a second writer would have raced it. That test has been
      // REPLACED rather than relaxed: the browser can no longer write `metadata`
      // at all (the Marketplace API refuses it), so the property worth pinning has
      // inverted. If this stops writing, the field stops being settable.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(res.statusCode).toBe(200);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0][0]).toMatchObject({
        id: LISTING_ID,
        metadata: { assignedLaundryId: LAUNDRY_B },
      });
    });

    it('writes the id, the initial cleaning turnaround and all three derived fields in ONE call', async () => {
      // One call so they cannot land separately. `geolocation` is a top-level
      // attribute rather than extended data; the Integration API accepts it
      // alongside publicData and metadata (verified against Dev), which is what
      // makes a single call possible at all.
      //
      // `initialCleaningDays` rides along for the same reason: an assignment whose
      // turnaround failed to land would leave the calendar offering tomorrow for a
      // garment that is not there, which is the exact bug it exists to fix.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(update).toHaveBeenCalledTimes(1);
      const params = update.mock.calls[0][0];
      // The fixture laundry configures no turnaround at all, so this is the bottom
      // of the fallback chain.
      expect(params.metadata).toEqual({
        assignedLaundryId: LAUNDRY_B,
        initialCleaningDays: HARDCODED_DEFAULT_BUFFER_DAYS,
      });
      expect(params.publicData).toEqual({
        assignedLaundryName: 'Maison du Marais',
        pickupAddress: '5 Rue des Rosiers, Paris',
      });
      expect(params.geolocation).toMatchObject({ lat: 48.857, lng: 2.359 });
    });

    // ---------------------------------------------------------------------------
    //   > "se muestra el displayName de cada laundry, pero debe ser el nombre de la laundry,
    //   >  no del user"
    //
    // Reported against the assignment picker, but the picker only shows what this endpoint
    // writes: `assignedLaundryName` is what the listing card, the listing page and the inbox
    // panel all read. The default fixture gives the account and the studio the SAME name, so
    // the precedence is invisible to every other test in this file - which is how it survived.
    // ---------------------------------------------------------------------------
    it('stamps the studio name, not the name on the account', async () => {
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        laundry: laundryUserEntity({ profile: { displayName: 'Jonathan P' } }),
      });

      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(update.mock.calls[0][0].publicData.assignedLaundryName).toBe('Maison du Marais');
    });

    // Blank is worse than the account's name: an owner picking where their garment goes has to
    // be able to tell the options apart, and a studio that has not filled in its profile name
    // yet must still be nameable.
    it('falls back to the account name when the studio has not named itself', async () => {
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        laundry: laundryUserEntity({
          profile: {
            displayName: 'Jonathan P',
            publicData: {
              laundryProfile: {
                address: '5 Rue des Rosiers, Paris',
                origin: { lat: 48.857, lng: 2.359 },
              },
            },
          },
        }),
      });

      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(update.mock.calls[0][0].publicData.assignedLaundryName).toBe('Jonathan P');
    });

    it('resolves the turnaround for THIS garment category, from the laundry profile', async () => {
      // The listing fixture is filed under `dresses`, and this studio takes 4 days
      // over a dress. A studio-wide average would be the wrong number as often as
      // the right one.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        laundry: laundryUserEntity({
          profile: {
            privateData: { turnaroundDays: 1, categoryPricing: { dresses: { turnaroundDays: 4 } } },
          },
        }),
      });
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(update.mock.calls[0][0].metadata.initialCleaningDays).toBe(4);
    });

    it('never takes the turnaround from the request body', async () => {
      // A caller who could supply this could make their own garment bookable
      // tomorrow, which is the whole rule.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      await run({
        listingId: LISTING_ID,
        assignedLaundryId: LAUNDRY_B,
        initialCleaningDays: 0,
      });

      expect(update.mock.calls[0][0].metadata.initialCleaningDays).toBe(
        HARDCODED_DEFAULT_BUFFER_DAYS
      );
    });

    it('does not touch the custody keys another writer owns', async () => {
      // `onLaundry` / `readyAt` belong to api-util/listingCustody.js. Sharetribe
      // merges extended data per top-level key (re-verified against Dev for this
      // write - see writeLaundryAssignment), so neither writer has to know about the
      // other's fields; what it must NOT do is send them and overwrite them.
      const { update } = setupSdk(
        listingEntity({ metadata: { onLaundry: false, readyAt: '2026-08-01T00:00:00.000Z' } })
      );
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(update.mock.calls[0][0].metadata).not.toHaveProperty('onLaundry');
      expect(update.mock.calls[0][0].metadata).not.toHaveProperty('readyAt');
    });

    it('derives the address and location from the laundry, never from the body', async () => {
      // The point of writing them together. A caller who could supply these could
      // leave the id alone and rewrite the pickup address a customer relies on.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      await run({
        listingId: LISTING_ID,
        assignedLaundryId: LAUNDRY_B,
        pickupAddress: '1 Attacker Street',
        assignedLaundryName: 'Not A Studio',
        geolocation: { lat: 0, lng: 0 },
      });

      const params = update.mock.calls[0][0];
      expect(params.publicData.pickupAddress).toBe('5 Rue des Rosiers, Paris');
      expect(params.publicData.assignedLaundryName).toBe('Maison du Marais');
      expect(params.geolocation).toMatchObject({ lat: 48.857, lng: 2.359 });
    });

    it('does not clear the old publicData key as a side effect of a save', async () => {
      // Cleanup of the legacy copy belongs to
      // scripts/migrate-assigned-laundry-to-metadata.js, which reports exactly what
      // it touched. A save quietly deleting data would make that accounting wrong.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(update.mock.calls[0][0].publicData).not.toHaveProperty('assignedLaundryId');
    });

    it('refuses a target who is not flagged isLaundry', async () => {
      // An owner must not be able to appoint themselves - or a friend - as their own
      // garment's laundry, which would hand them the custody chain and the payout
      // transition on their own rental.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        laundry: laundryUserEntity({ isLaundry: false }),
      });
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(res.statusCode).toBe(422);
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses a laundry with no usable address or origin', async () => {
      // Writing no `geolocation` leaves the LAUNDRY tab permanently incomplete and
      // the owner unable to publish, with nothing shown to explain it.
      const { update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }), {
        laundry: laundryUserEntity({
          profile: { publicData: { laundryProfile: { studioName: 'No Address Studio' } } },
        }),
      });
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(res.statusCode).toBe(422);
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses a laundry that does not exist', async () => {
      const { sdk, update } = setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      sdk.users.show = jest.fn(() => Promise.reject(new Error('404')));

      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(422);
      expect(update).not.toHaveBeenCalled();
    });

    it('reports back what it wrote, so the wizard need not guess', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: false } }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

      expect(res.body.data).toMatchObject({
        allowed: true,
        assignedLaundryId: LAUNDRY_B,
        initialCleaningDays: HARDCODED_DEFAULT_BUFFER_DAYS,
        assignedLaundryName: 'Maison du Marais',
        pickupAddress: '5 Rue des Rosiers, Paris',
        geolocation: { lat: 48.857, lng: 2.359 },
      });
    });
  });
});

// ---------------------------------------------------------------------------
// §3.12 New Incoming Garment.
//
// The notification body existed, was exported and was unit-tested for over a
// week without a single caller: it fires when an owner ships a garment in, and
// there is no transaction then, so there was no transition to hang it off. This
// endpoint is the trigger - the moment the owner commits to a studio.
//
// The interesting requirement is NOT "does it send". It is "does it stay quiet".
// The wizard's LAUNDRY tab can be saved over and over with the same studio
// selected, and each of those is a legitimate 200. Three clicks on Save must be
// one email, not three.
// ---------------------------------------------------------------------------
describe('the New Incoming Garment notification to the chosen studio', () => {
  const assignable = () => listingEntity({ metadata: { onLaundry: false } });

  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`, so re-arm the two mocks
    // this endpoint needs on every test (as the suite above does).
    requireListingAuthorCaller.mockResolvedValue({ id: { uuid: OWNER_ID } });
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error', data: e.data });
      res.end();
    });
  });

  it('tells the studio to expect a garment when the assignment actually changes', async () => {
    setupSdk(assignable());

    const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.changed).toBe(true);
    expect(notifyNewIncomingGarment).toHaveBeenCalledTimes(1);
    expect(notifyNewIncomingGarment).toHaveBeenCalledWith(
      expect.objectContaining({
        // Resolved from the laundry's own account via the Integration API, never
        // from the request body.
        to: 'studio@marais.example.com',
        laundryName: 'Maison du Marais',
        ownerName: 'Amélie Rousseau',
        listingId: LISTING_ID.uuid,
        category: 'dresses',
      })
    );
  });

  it('does NOT email again on a no-op re-save of the same studio', async () => {
    // listingEntity() already has LAUNDRY_A assigned, and the request re-picks
    // LAUNDRY_A. This is the "owner pressed Save three times" case.
    setupSdk(listingEntity({ assignedLaundryId: LAUNDRY_A, metadata: { onLaundry: false } }));

    const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_A });

    // Still a success, and still re-writes the derived fields - it just does not
    // announce anything, because nothing was announced.
    expect(res.statusCode).toBe(200);
    expect(res.body.data.changed).toBe(false);
    expect(notifyNewIncomingGarment).not.toHaveBeenCalled();
  });

  it('sends exactly one email across three identical saves', async () => {
    // The end-to-end version of the gate: change once, then re-save twice. Only
    // the first save is a change, so only the first sends.
    setupSdk(assignable());
    await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    setupSdk(listingEntity({ assignedLaundryId: LAUNDRY_B, metadata: { onLaundry: false } }));
    await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
    await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    expect(notifyNewIncomingGarment).toHaveBeenCalledTimes(1);
  });

  it('does not email when the assignment was refused', async () => {
    // A garment already at a studio cannot be reassigned (409). Nothing changed,
    // so nothing may be announced - least of all to a studio that is not getting
    // the garment.
    setupSdk(listingEntity({ metadata: { onLaundry: true } }));

    const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    expect(res.statusCode).toBe(409);
    expect(notifyNewIncomingGarment).not.toHaveBeenCalled();
  });

  it('still answers 200 when the mailer cannot send', async () => {
    // The write has already landed by the time this fires. Mailgun is entirely
    // unconfigured in Dev, so this is the ONLY path that runs there today: it has
    // to be invisible to the caller. If it were not, an owner would be sent back
    // to re-save an assignment that had in fact been saved.
    notifyNewIncomingGarment.mockResolvedValueOnce({ sent: false, reason: 'not-configured' });
    setupSdk(assignable());

    const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.assignedLaundryId).toBe(LAUNDRY_B);
    expect(handleError).not.toHaveBeenCalled();
  });

  it('does not fail the request even if the mailer throws synchronously', async () => {
    // laundryMailer is documented never to reject, but this endpoint must not
    // depend on that promise: a regression there must not cost an owner their
    // assignment. (Same reasoning as laundry-transaction-status.test.js.)
    notifyNewIncomingGarment.mockImplementationOnce(() => {
      throw new Error('mailer exploded');
    });
    setupSdk(assignable());

    const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    expect(res.statusCode).toBe(200);
    expect(handleError).not.toHaveBeenCalled();
  });

  it('sends even when the studio has no email on file, and lets the mailer log it', async () => {
    // Resolving no address is the mailer's `no-recipient` skip (which now logs).
    // The endpoint deliberately does not pre-filter on it: swallowing the call
    // here would mean nothing ever reported the misconfigured studio.
    //
    // The key is DELETED rather than passed as undefined - the Integration API
    // can hand back a user entity with no `email` attribute at all, and a default
    // parameter would quietly fill one back in.
    const noEmail = laundryUserEntity();
    delete noEmail.attributes.email;
    setupSdk(assignable(), { laundry: noEmail });

    const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    expect(res.statusCode).toBe(200);
    expect(notifyNewIncomingGarment).toHaveBeenCalledWith(
      expect.objectContaining({ to: undefined })
    );
  });
});
