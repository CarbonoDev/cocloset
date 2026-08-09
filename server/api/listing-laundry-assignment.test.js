jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/listingOwnerAuth', () => ({
  requireListingAuthorCaller: jest.fn(),
}));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireListingAuthorCaller } = require('../api-util/listingOwnerAuth');

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

const listingEntity = ({ assignedLaundryId = LAUNDRY_A, metadata = {} } = {}) => ({
  id: LISTING_ID,
  type: 'listing',
  attributes: { publicData: { assignedLaundryId }, metadata },
  relationships: { author: { data: { id: { uuid: OWNER_ID }, type: 'user' } } },
});

const setupSdk = listing => {
  const show = jest.fn(() => Promise.resolve({ data: { data: listing } }));
  getIntegrationSdk.mockReturnValue({ listings: { show } });
  return { show };
};

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
// the garment to a studio that has never seen it.
// ---------------------------------------------------------------------------

describe('evaluateLaundryAssignment', () => {
  it('allows a first assignment (no laundry yet, no custody)', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: undefined,
        nextAssignedLaundryId: LAUNDRY_A,
        onLaundry: undefined,
      })
    ).toEqual({ allowed: true, changed: true });
  });

  it('allows a change while the garment is with its owner', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        onLaundry: false,
      })
    ).toEqual({ allowed: true, changed: true });
  });

  it('REFUSES a change while the garment is at the laundry', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: LAUNDRY_A,
        nextAssignedLaundryId: LAUNDRY_B,
        onLaundry: true,
      })
    ).toEqual({ allowed: false, changed: true });
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
    ).toEqual({ allowed: true, changed: false });
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

  it('normalises absent vs empty so an unset laundry is not a "change" to itself', () => {
    expect(
      evaluateLaundryAssignment({
        currentAssignedLaundryId: null,
        nextAssignedLaundryId: null,
        onLaundry: true,
      })
    ).toEqual({ allowed: true, changed: false });
  });
});

describe('listing-laundry-assignment', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    requireListingAuthorCaller.mockResolvedValue({ id: { uuid: OWNER_ID } });
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
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
    it('answers 403 for a caller who is not the listing owner', async () => {
      setupSdk(listingEntity());
      const error = new Error('Caller is not the owner of this listing.');
      error.status = 403;
      error.statusText = 'Caller is not the owner of this listing.';
      error.data = {};
      requireListingAuthorCaller.mockRejectedValue(error);

      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.statusCode).toBe(403);
    });

    it('does not accept the assigned laundry as a substitute for the owner', async () => {
      // Choosing who cleans a garment is the owner's decision, and a studio has an
      // obvious interest in the answer.
      setupSdk(listingEntity());
      const error = new Error('Caller is not the owner of this listing.');
      error.status = 403;
      error.statusText = 'Caller is not the owner of this listing.';
      error.data = {};
      requireListingAuthorCaller.mockRejectedValue(error);

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
  });

  describe('the guard', () => {
    it('allows a change while the garment is home', async () => {
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

    it('names the reason in the 409, so the wizard can say why', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });
      expect(res.body.error).toMatch(/at the laundry/i);
    });

    it('allows re-saving the same laundry while the garment is at the laundry', async () => {
      setupSdk(listingEntity({ metadata: { onLaundry: true } }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_A });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({ allowed: true, changed: false, onLaundry: true });
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

    it('allows a first assignment on a listing that has never had one', async () => {
      setupSdk(listingEntity({ assignedLaundryId: null, metadata: {} }));
      const res = await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_A });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toMatchObject({ changed: true, currentAssignedLaundryId: null });
    });
  });

  it('never writes anything', async () => {
    // This endpoint is a decision, not a write path - see its header. An
    // `update` appearing here would be a second writer racing the wizard's own.
    const show = jest.fn(() => Promise.resolve({ data: { data: listingEntity() } }));
    const sdk = { listings: { show } };
    getIntegrationSdk.mockReturnValue(sdk);

    await run({ listingId: LISTING_ID, assignedLaundryId: LAUNDRY_B });

    expect(sdk.listings.update).toBeUndefined();
  });
});
