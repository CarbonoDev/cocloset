jest.mock('../api-util/sdk', () => ({ handleError: jest.fn() }));
jest.mock('../api-util/integrationSdk', () => ({ getIntegrationSdk: jest.fn() }));
jest.mock('../api-util/laundryAuth', () => ({ requireLaundryCaller: jest.fn() }));
jest.mock('../api-util/laundryAddress', () => ({
  propagateAddressToAssignedListings: jest.fn(),
}));
jest.mock('../log', () => ({ error: jest.fn() }));

const { handleError } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { requireLaundryCaller } = require('../api-util/laundryAuth');
const { propagateAddressToAssignedListings } = require('../api-util/laundryAddress');

const refresh = require('./laundry-listings-refresh');

// WHY THIS FILE EXISTS
//
//   > "si laundry cambia su nombre (...) los listings no se actualizan; puedes cambiar este
//   >  comportamiento?" (Jonathan, 2026-09-09)
//
// This endpoint takes no arguments on purpose - the session is the studio, and it writes the
// studio's own stored profile onto the studio's own listings. That is the whole reason it can
// be called after any profile save without weakening the permission that gates address
// changes, so the assertions below are mostly about what it refuses to be told.

const LAUNDRY_ID = '22222222-2222-2222-2222-222222222222';

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

const laundryUser = ({ studioName = 'Studio Pigalle', address = '3 Rue Yvonne', origin } = {}) => ({
  id: { uuid: LAUNDRY_ID },
  attributes: {
    profile: {
      displayName: 'Pigalle Cleaners',
      publicData: {
        laundryProfile: {
          studioName,
          address,
          origin: origin === undefined ? { lat: 48.88, lng: 2.34 } : origin,
        },
      },
    },
  },
});

const run = async (body = {}) => {
  const res = mockRes();
  await refresh({ body }, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  getIntegrationSdk.mockReturnValue({});
  handleError.mockImplementation((res, e) => {
    res.status(e.status || 500).json(e.data || {});
    return res;
  });
  propagateAddressToAssignedListings.mockResolvedValue({
    updated: [{ id: 'listing-1' }],
    failed: [],
    skipped: [],
    scanned: 1,
    truncated: false,
  });
});

describe('laundry-listings-refresh', () => {
  it("re-stamps the studio's own profile onto its own listings", async () => {
    requireLaundryCaller.mockResolvedValue(laundryUser());

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(propagateAddressToAssignedListings).toHaveBeenCalledWith(
      expect.objectContaining({
        laundryId: LAUNDRY_ID,
        laundry: expect.objectContaining({
          studioName: 'Studio Pigalle',
          address: '3 Rue Yvonne',
          origin: { lat: 48.88, lng: 2.34 },
        }),
      })
    );
  });

  it('cannot be told which studio, name or address to write', async () => {
    // The security story: a caller who could pass any of these could rename someone else's
    // garments. There is nothing here to steer.
    requireLaundryCaller.mockResolvedValue(laundryUser());

    await run({
      laundryId: 'somebody-else',
      studioName: 'Not Their Name',
      address: 'Not their address',
      listingIds: ['a-listing'],
    });

    const call = propagateAddressToAssignedListings.mock.calls[0][0];
    expect(call.laundryId).toBe(LAUNDRY_ID);
    expect(call.laundry.studioName).toBe('Studio Pigalle');
    expect(call.laundry.address).toBe('3 Rue Yvonne');
  });

  it('writes nothing for a studio that has no address yet', async () => {
    // The derived fields are written together; half of them is a listing whose printed
    // address and map pin disagree. An ordinary thing to do, so a no-op rather than an error.
    requireLaundryCaller.mockResolvedValue(laundryUser({ origin: null }));

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.data.listings.reason).toBe('no-address-yet');
    expect(propagateAddressToAssignedListings).not.toHaveBeenCalled();
  });

  it('refuses a caller that is not a laundry, and writes nothing', async () => {
    const forbidden = new Error('Not a laundry');
    forbidden.status = 403;
    forbidden.data = {};
    requireLaundryCaller.mockRejectedValue(forbidden);

    const res = await run();

    expect(res.statusCode).toBe(403);
    expect(propagateAddressToAssignedListings).not.toHaveBeenCalled();
  });

  it('still answers 200 when some listings could not be written', async () => {
    // The profile has already saved by the time this runs. Reporting a partial propagation as
    // a failure would tell the studio its rename did not stick when it did.
    requireLaundryCaller.mockResolvedValue(laundryUser());
    propagateAddressToAssignedListings.mockResolvedValue({
      updated: [],
      failed: [{ id: 'listing-1' }],
      skipped: [],
      scanned: 1,
      truncated: false,
    });

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.data.listings.failed).toHaveLength(1);
  });
});
