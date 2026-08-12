jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/laundryAuth', () => ({
  requireLaundryCaller: jest.fn(),
}));

jest.mock('../log', () => ({ error: jest.fn(), devLogger: jest.fn() }));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');
const { requireLaundryCaller } = require('../api-util/laundryAuth');
const { ADDRESS_CHANGE_ALLOWED_KEY } = require('../api-util/laundryAddress');

const laundryAddressEndpoint = require('./laundry-address');
const { evaluateAddressChange } = laundryAddressEndpoint;

const LAUNDRY_ID = 'laundry-a';
const OTHER_LAUNDRY_ID = 'laundry-b';

const OLD_ADDRESS = '21 Rue Frochot, 75009 Paris';
const OLD_ORIGIN = { lat: 48.879, lng: 2.337 };
const NEW_ADDRESS = '5 Rue des Rosiers, 75004 Paris';
const NEW_ORIGIN = { lat: 48.857, lng: 2.359 };

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

const laundryUserEntity = ({
  id = LAUNDRY_ID,
  isLaundry = true,
  addressChangeAllowed,
  address = OLD_ADDRESS,
  origin = OLD_ORIGIN,
  studioName = 'Maison du Marais',
} = {}) => ({
  id: { uuid: id },
  type: 'user',
  attributes: {
    profile: {
      displayName: 'Maison du Marais',
      metadata: { isLaundry, [ADDRESS_CHANGE_ALLOWED_KEY]: addressChangeAllowed },
      publicData: {
        laundryProfile: {
          studioName,
          businessHours: 'Mon-Sat 11-21',
          ...(address ? { address } : {}),
          ...(origin ? { origin } : {}),
        },
      },
      privateData: {},
    },
  },
});

const listingEntity = ({ id = 'listing-1', assignedLaundryId = LAUNDRY_ID } = {}) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    title: `Garment ${id}`,
    state: 'published',
    geolocation: OLD_ORIGIN,
    publicData: { pickupAddress: OLD_ADDRESS, assignedLaundryName: 'Maison du Marais' },
    metadata: { assignedLaundryId },
  },
});

// `storedUser` is what the Integration API read returns (the authority for the
// decision). `updatedUser` is what the write returns, and defaults to the stored
// profile with the NEW address applied - i.e. what Sharetribe would really hand back.
const setupSdk = ({
  storedUser = laundryUserEntity(),
  updatedUser,
  listings = [listingEntity()],
  updateProfileReject,
  listingUpdateReject,
} = {}) => {
  const usersShow = jest.fn(() => Promise.resolve({ data: { data: storedUser } }));
  const usersUpdateProfile = jest.fn(() =>
    updateProfileReject
      ? Promise.reject(Object.assign(new Error('nope'), { status: 500 }))
      : Promise.resolve({
          data: {
            data: updatedUser || laundryUserEntity({ address: NEW_ADDRESS, origin: NEW_ORIGIN }),
          },
        })
  );
  const listingsQuery = jest.fn(() =>
    Promise.resolve({ data: { data: listings, meta: { totalPages: 1 } } })
  );
  const listingsUpdate = jest.fn(() =>
    listingUpdateReject
      ? Promise.reject({ data: { errors: [{ code: 'boom' }] } })
      : Promise.resolve({ data: { data: {} } })
  );

  const sdk = {
    users: { show: usersShow, updateProfile: usersUpdateProfile },
    listings: { query: listingsQuery, update: listingsUpdate },
  };
  getIntegrationSdk.mockReturnValue(sdk);
  return { sdk, usersShow, usersUpdateProfile, listingsQuery, listingsUpdate };
};

const asLaundry = (id = LAUNDRY_ID) => {
  requireLaundryCaller.mockReturnValue(Promise.resolve({ id: { uuid: id } }));
};

const run = async (body, res = mockRes()) => {
  await laundryAddressEndpoint({ body }, res);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return res;
};

const validBody = { address: NEW_ADDRESS, origin: NEW_ORIGIN };

beforeEach(() => {
  handleError.mockReset();
});

describe('POST /api/laundry-address', () => {
  // ── BRANCH 1: ONBOARDING ───────────────────────────────────────────────────
  // A studio with no usable address is invisible in the picker and can be
  // assigned nothing, so requiring an admin grant for the FIRST address would
  // strand every new studio behind a support ticket for something no rule
  // protects.
  it('allows a studio with no stored address to set one, with no grant', async () => {
    asLaundry();
    const { usersUpdateProfile } = setupSdk({
      storedUser: laundryUserEntity({ address: null, origin: null }),
      listings: [],
    });

    const res = await run(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.reason).toBe('no-address-yet');
    expect(usersUpdateProfile).toHaveBeenCalledTimes(1);
    // No grant existed, so there is nothing to spend.
    expect(usersUpdateProfile.mock.calls[0][0]).not.toHaveProperty('metadata');
  });

  // THE TRAP: an address string with no coordinates is excluded from the picker
  // exactly as hard as no address at all, so it counts as "not set up yet" and must
  // stay changeable - otherwise the studio is locked out of fixing what is broken.
  it('treats an address with no usable origin as still onboarding', async () => {
    asLaundry();
    setupSdk({
      storedUser: laundryUserEntity({ address: OLD_ADDRESS, origin: null }),
      listings: [],
    });

    const res = await run(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.reason).toBe('no-address-yet');
  });

  // ── BRANCH 2: A GRANTED CHANGE ─────────────────────────────────────────────
  it('allows a change when an admin has granted it, and spends the grant', async () => {
    asLaundry();
    const { usersUpdateProfile } = setupSdk({
      storedUser: laundryUserEntity({ addressChangeAllowed: true }),
      listings: [],
    });

    const res = await run(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.reason).toBe('change-granted');
    expect(res.body.data.addressChangeAllowed).toBe(false);
    // ONE-SHOT: the flag is cleared in the SAME call that writes the address, so
    // there is no window in which a granted studio can change the address twice.
    expect(usersUpdateProfile.mock.calls[0][0].metadata).toEqual({
      [ADDRESS_CHANGE_ALLOWED_KEY]: false,
    });
  });

  it('merges the new address into the stored laundryProfile instead of replacing it', async () => {
    asLaundry();
    const { usersUpdateProfile } = setupSdk({
      storedUser: laundryUserEntity({ addressChangeAllowed: true }),
      listings: [],
    });

    await run(validBody);

    // Sharetribe merges extended data by top-level key only, and `laundryProfile`
    // is one key holding a nested object: a non-merging write would silently
    // destroy the studio name and business hours.
    expect(usersUpdateProfile.mock.calls[0][0].publicData.laundryProfile).toEqual({
      studioName: 'Maison du Marais',
      businessHours: 'Mon-Sat 11-21',
      address: NEW_ADDRESS,
      origin: NEW_ORIGIN,
    });
  });

  // ── BRANCH 3: REFUSED ──────────────────────────────────────────────────────
  it('refuses a change when the studio has an address and no grant', async () => {
    asLaundry();
    const { usersUpdateProfile, listingsUpdate } = setupSdk();

    await run(validBody);

    expect(handleError).toHaveBeenCalledTimes(1);
    const error = handleError.mock.calls[0][1];
    expect(error.status).toBe(403);
    // The CODE is what the form switches its translated message on. Switching on
    // `statusText` would put an English server sentence on a translated page.
    expect(error.data).toEqual({ code: 'change-not-allowed' });
    // And nothing was written, on either the profile or any listing.
    expect(usersUpdateProfile).not.toHaveBeenCalled();
    expect(listingsUpdate).not.toHaveBeenCalled();
  });

  it.each([['true'], [1], [{}], [null]])(
    'refuses a truthy-but-not-true grant (%p) and writes nothing',
    async untrustedValue => {
      asLaundry();
      const { usersUpdateProfile } = setupSdk({
        storedUser: laundryUserEntity({ addressChangeAllowed: untrustedValue }),
      });

      await run(validBody);

      expect(handleError.mock.calls[0][1].data).toEqual({ code: 'change-not-allowed' });
      expect(usersUpdateProfile).not.toHaveBeenCalled();
    }
  );

  // ── PROPAGATION ────────────────────────────────────────────────────────────
  it('propagates the new address to every listing assigned to the caller', async () => {
    asLaundry();
    const { listingsUpdate } = setupSdk({
      storedUser: laundryUserEntity({ addressChangeAllowed: true }),
      listings: [
        listingEntity({ id: 'mine-1' }),
        listingEntity({ id: 'theirs', assignedLaundryId: OTHER_LAUNDRY_ID }),
        listingEntity({ id: 'mine-2' }),
      ],
    });

    const res = await run(validBody);

    expect(res.body.data.listings.updated.map(entry => entry.id)).toEqual(['mine-1', 'mine-2']);
    expect(listingsUpdate).toHaveBeenCalledTimes(2);

    const params = listingsUpdate.mock.calls[0][0];
    expect(params.publicData.pickupAddress).toBe(NEW_ADDRESS);
    expect(params.geolocation.lat).toBe(NEW_ORIGIN.lat);
    expect(params.geolocation.lng).toBe(NEW_ORIGIN.lng);
  });

  // The propagated values are read back off the UPDATED user entity, not off the
  // request body: the body is one step removed from what actually landed in storage,
  // and the listings must receive exactly what an assignment would have written.
  it('propagates a renamed studio name too', async () => {
    asLaundry();
    const { listingsUpdate } = setupSdk({
      storedUser: laundryUserEntity({ addressChangeAllowed: true }),
      updatedUser: laundryUserEntity({ address: NEW_ADDRESS, origin: NEW_ORIGIN }),
    });

    await run(validBody);

    expect(listingsUpdate.mock.calls[0][0].publicData.assignedLaundryName).toBe('Maison du Marais');
  });

  // Distinguishes "propagate what landed" from "propagate what was asked for". They
  // agree in the happy path, which is exactly why the difference needs its own test:
  // if storage ever disagrees with the request - a concurrent write, a normalisation,
  // a partially applied update - the listings must follow STORAGE. Otherwise the
  // studio's profile and its garments silently point at different places, and nothing
  // in the system notices.
  it('propagates what actually landed in storage, not what the request asked for', async () => {
    asLaundry();
    const STORED_ADDRESS = '5 Rue des Rosiers, 75004 Paris, France';
    const STORED_ORIGIN = { lat: 48.8571, lng: 2.3591 };
    const { listingsUpdate } = setupSdk({
      storedUser: laundryUserEntity({ addressChangeAllowed: true }),
      updatedUser: laundryUserEntity({ address: STORED_ADDRESS, origin: STORED_ORIGIN }),
    });

    const res = await run(validBody);

    const params = listingsUpdate.mock.calls[0][0];
    expect(params.publicData.pickupAddress).toBe(STORED_ADDRESS);
    expect(params.geolocation.lat).toBe(STORED_ORIGIN.lat);
    expect(params.geolocation.lng).toBe(STORED_ORIGIN.lng);
    // And the response tells the client the same stored values, not its own input.
    expect(res.body.data.address).toBe(STORED_ADDRESS);
    expect(res.body.data.origin).toEqual(STORED_ORIGIN);
  });

  // The profile write has already landed by the time propagation runs, so a 500 here
  // would tell the studio its address did not save when it did - and the retry would
  // then be refused, because the grant has been spent.
  it('still answers 200 when a listing write fails, and reports the failure', async () => {
    asLaundry();
    setupSdk({
      storedUser: laundryUserEntity({ addressChangeAllowed: true }),
      listingUpdateReject: true,
    });

    const res = await run(validBody);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.listings.failed.map(entry => entry.id)).toEqual(['listing-1']);
    expect(res.body.data.listings.updated).toEqual([]);
    expect(handleError).not.toHaveBeenCalled();
  });

  // ── IDENTITY AND VALIDATION ────────────────────────────────────────────────
  // The target is ALWAYS the caller. There is no id parameter anywhere in the
  // handler, so no body can aim it at another studio.
  it('reads the target laundry from the session, never from the body', async () => {
    asLaundry(OTHER_LAUNDRY_ID);
    const { usersShow, usersUpdateProfile } = setupSdk({
      storedUser: laundryUserEntity({ id: OTHER_LAUNDRY_ID, address: null, origin: null }),
      listings: [],
    });

    await run({ ...validBody, laundryId: LAUNDRY_ID, id: LAUNDRY_ID });

    expect(usersShow.mock.calls[0][0]).toEqual({ id: OTHER_LAUNDRY_ID });
    expect(usersUpdateProfile.mock.calls[0][0].id).toBe(OTHER_LAUNDRY_ID);
  });

  it('rejects a caller who is not a laundry', async () => {
    const forbidden = Object.assign(new Error('Caller is not a laundry user.'), {
      status: 403,
      data: {},
    });
    requireLaundryCaller.mockReturnValue(Promise.reject(forbidden));
    const { usersUpdateProfile } = setupSdk();

    await run(validBody);

    expect(handleError).toHaveBeenCalledWith(expect.anything(), forbidden);
    expect(usersUpdateProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing body', undefined],
    ['no address', { origin: NEW_ORIGIN }],
    ['a blank address', { address: '  ', origin: NEW_ORIGIN }],
    ['no origin', { address: NEW_ADDRESS }],
    ['a stringly-typed origin', { address: NEW_ADDRESS, origin: { lat: '1', lng: '2' } }],
  ])('answers 400 for %s, without reading or writing anything', async (name, body) => {
    asLaundry();
    const { usersShow, usersUpdateProfile } = setupSdk();

    await run(body);

    expect(handleError.mock.calls[0][1].status).toBe(400);
    expect(usersShow).not.toHaveBeenCalled();
    expect(usersUpdateProfile).not.toHaveBeenCalled();
  });

  it('re-checks isLaundry on the authoritative read, not only on the session', async () => {
    // The session said "laundry"; the stored entity says otherwise. The decision is
    // taken from the same source that performs the write.
    asLaundry();
    const { usersUpdateProfile } = setupSdk({
      storedUser: laundryUserEntity({ isLaundry: false }),
    });

    await run(validBody);

    expect(handleError.mock.calls[0][1].data).toEqual({ code: 'not-a-laundry' });
    expect(usersUpdateProfile).not.toHaveBeenCalled();
  });
});

// Re-exported so the rule stays reachable from the endpoint's own test file, the
// same way listing-laundry-assignment.js re-exports evaluateLaundryAssignment.
describe('evaluateAddressChange (re-exported)', () => {
  it('is the same rule the endpoint applies', () => {
    expect(
      evaluateAddressChange({ hasUsableStoredAddress: true, addressChangeAllowed: true }).allowed
    ).toBe(true);
    expect(
      evaluateAddressChange({ hasUsableStoredAddress: true, addressChangeAllowed: false }).allowed
    ).toBe(false);
  });
});
