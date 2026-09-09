const {
  ADDRESS_CHANGE_ALLOWED_KEY,
  ALL_LISTING_STATES,
  evaluateAddressChange,
  findListingsAssignedToLaundry,
  parseAddressInput,
  propagateAddressToAssignedListings,
  readAddressChangeAllowed,
  readLaundryAddressState,
  writeLaundryAddress,
} = require('./laundryAddress');

const LAUNDRY_ID = 'laundry-a';
const OTHER_LAUNDRY_ID = 'laundry-b';

const NEW_ADDRESS = '5 Rue des Rosiers, 75004 Paris';
const NEW_ORIGIN = { lat: 48.857, lng: 2.359 };

const laundryUserEntity = ({
  id = LAUNDRY_ID,
  isLaundry = true,
  addressChangeAllowed,
  laundryProfile = {
    studioName: 'Maison du Marais',
    address: '21 Rue Frochot, Paris',
    origin: { lat: 48.879, lng: 2.337 },
    businessHours: 'Mon-Sat 11-21',
  },
} = {}) => ({
  id: { uuid: id },
  type: 'user',
  attributes: {
    profile: {
      displayName: 'Maison du Marais',
      metadata: { isLaundry, [ADDRESS_CHANGE_ALLOWED_KEY]: addressChangeAllowed },
      publicData: { laundryProfile },
      privateData: {},
    },
  },
});

const listingEntity = ({
  id = 'listing-1',
  assignedLaundryId = LAUNDRY_ID,
  state = 'published',
  publicData = {},
  geolocation = { lat: 48.879, lng: 2.337 },
} = {}) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    title: `Garment ${id}`,
    state,
    geolocation,
    publicData: { pickupAddress: '21 Rue Frochot, Paris', ...publicData },
    metadata: { assignedLaundryId },
  },
});

describe('readAddressChangeAllowed()', () => {
  it('is true only for a real boolean true', () => {
    expect(readAddressChangeAllowed(laundryUserEntity({ addressChangeAllowed: true }))).toBe(true);
  });

  // A permission that a string or a 1 satisfies is not a permission.
  it.each([['true'], [1], [{}], [false], [null], [undefined]])('is false for %p', value => {
    expect(readAddressChangeAllowed(laundryUserEntity({ addressChangeAllowed: value }))).toBe(
      false
    );
  });

  it('tolerates a missing user', () => {
    expect(readAddressChangeAllowed(undefined)).toBe(false);
    expect(readAddressChangeAllowed({})).toBe(false);
  });
});

describe('evaluateAddressChange()', () => {
  // ONBOARDING ALWAYS WORKS. Without this branch a new studio could never set its
  // first address, and it is invisible in the picker until it has one.
  it('allows a studio with no usable stored address, with no grant', () => {
    expect(
      evaluateAddressChange({ hasUsableStoredAddress: false, addressChangeAllowed: false })
    ).toEqual({ allowed: true, reason: 'no-address-yet' });
  });

  it('allows a studio with a usable address once the grant is present', () => {
    expect(
      evaluateAddressChange({ hasUsableStoredAddress: true, addressChangeAllowed: true })
    ).toEqual({ allowed: true, reason: 'change-granted' });
  });

  it('refuses a studio with a usable address and no grant', () => {
    expect(
      evaluateAddressChange({ hasUsableStoredAddress: true, addressChangeAllowed: false })
    ).toEqual({ allowed: false, reason: 'change-not-allowed' });
  });

  // The gate is `=== true` at the reader; this asserts the rule itself does not
  // re-introduce truthiness.
  it.each([['true'], [1], [{}], [undefined], [null]])(
    'refuses a truthy-but-not-true grant (%p)',
    value => {
      expect(
        evaluateAddressChange({ hasUsableStoredAddress: true, addressChangeAllowed: value })
      ).toEqual({ allowed: false, reason: 'change-not-allowed' });
    }
  );
});

describe('parseAddressInput()', () => {
  it('trims and returns a usable address plus origin', () => {
    expect(parseAddressInput({ address: `  ${NEW_ADDRESS}  `, origin: NEW_ORIGIN })).toEqual({
      address: NEW_ADDRESS,
      origin: NEW_ORIGIN,
    });
  });

  it('accepts an origin at 0,0', () => {
    expect(parseAddressInput({ address: 'Null Island', origin: { lat: 0, lng: 0 } })).toEqual({
      address: 'Null Island',
      origin: { lat: 0, lng: 0 },
    });
  });

  // Every rejection below would otherwise produce a studio that saved an address,
  // was told it succeeded, and stayed invisible in the picker.
  it.each([
    ['no body', undefined],
    ['no address', { origin: NEW_ORIGIN }],
    ['a blank address', { address: '   ', origin: NEW_ORIGIN }],
    ['a non-string address', { address: 42, origin: NEW_ORIGIN }],
    ['no origin', { address: NEW_ADDRESS }],
    ['half an origin', { address: NEW_ADDRESS, origin: { lat: 48.8 } }],
    ['a stringly-typed origin', { address: NEW_ADDRESS, origin: { lat: '48.8', lng: '2.3' } }],
    ['a NaN origin', { address: NEW_ADDRESS, origin: { lat: NaN, lng: 2.3 } }],
    ['an Infinity origin', { address: NEW_ADDRESS, origin: { lat: Infinity, lng: 2.3 } }],
  ])('rejects %s', (name, input) => {
    expect(parseAddressInput(input)).toBeNull();
  });
});

describe('readLaundryAddressState()', () => {
  const setup = user => {
    const show = jest.fn(() => Promise.resolve({ data: { data: user } }));
    return { integrationSdk: { users: { show } }, show };
  };

  it('reports a complete profile as having a usable stored address', async () => {
    const { integrationSdk } = setup(laundryUserEntity({ addressChangeAllowed: true }));
    const state = await readLaundryAddressState({ integrationSdk, laundryId: LAUNDRY_ID });

    expect(state.hasUsableStoredAddress).toBe(true);
    expect(state.addressChangeAllowed).toBe(true);
    expect(state.laundryProfile.studioName).toBe('Maison du Marais');
  });

  // THE TRAP. An address string with no coordinates is excluded from the picker
  // exactly as hard as no address at all, so it must read as "not set up yet" -
  // otherwise such a studio is locked out of fixing the very thing that is broken.
  it('reports an address with no origin as NOT usable', async () => {
    const { integrationSdk } = setup(
      laundryUserEntity({ laundryProfile: { studioName: 'S', address: 'somewhere' } })
    );
    const state = await readLaundryAddressState({ integrationSdk, laundryId: LAUNDRY_ID });

    expect(state.hasUsableStoredAddress).toBe(false);
  });

  it('refuses a user who is not flagged as a laundry', async () => {
    const { integrationSdk } = setup(laundryUserEntity({ isLaundry: false }));

    await expect(
      readLaundryAddressState({ integrationSdk, laundryId: LAUNDRY_ID })
    ).rejects.toMatchObject({ status: 403, data: { code: 'not-a-laundry' } });
  });
});

describe('writeLaundryAddress()', () => {
  const setup = () => {
    const updateProfile = jest.fn(params =>
      Promise.resolve({ data: { data: laundryUserEntity() }, params })
    );
    return { integrationSdk: { users: { updateProfile } }, updateProfile };
  };

  // THE DATA-LOSS TEST. Sharetribe merges extended data by TOP-LEVEL key, and
  // `laundryProfile` is one key holding a nested object: sending only
  // `{ address, origin }` replaces the whole thing and silently destroys the
  // studio's name and business hours.
  it('merges into the stored laundryProfile rather than replacing it', async () => {
    const { integrationSdk, updateProfile } = setup();

    await writeLaundryAddress({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundryProfile: { studioName: 'Maison du Marais', businessHours: 'Mon-Sat 11-21' },
      address: NEW_ADDRESS,
      origin: NEW_ORIGIN,
      reason: 'change-granted',
    });

    expect(updateProfile.mock.calls[0][0].publicData.laundryProfile).toEqual({
      studioName: 'Maison du Marais',
      businessHours: 'Mon-Sat 11-21',
      address: NEW_ADDRESS,
      origin: NEW_ORIGIN,
    });
  });

  it('writes the origin as plain JSON, not an SDK type', async () => {
    const { integrationSdk, updateProfile } = setup();

    await writeLaundryAddress({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundryProfile: {},
      address: NEW_ADDRESS,
      origin: NEW_ORIGIN,
      reason: 'no-address-yet',
    });

    const { origin } = updateProfile.mock.calls[0][0].publicData.laundryProfile;
    expect(Object.getPrototypeOf(origin)).toBe(Object.prototype);
    expect(origin).toEqual(NEW_ORIGIN);
  });

  // ONE-SHOT GRANT. An admin enables the change in order to make one change; a flag
  // left true forever quietly re-opens what it was added to control.
  it('spends the grant in the same call when one was used', async () => {
    const { integrationSdk, updateProfile } = setup();

    await writeLaundryAddress({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundryProfile: {},
      address: NEW_ADDRESS,
      origin: NEW_ORIGIN,
      reason: 'change-granted',
    });

    expect(updateProfile.mock.calls[0][0].metadata).toEqual({
      [ADDRESS_CHANGE_ALLOWED_KEY]: false,
    });
  });

  // Onboarding had no grant to spend. And an ADMIN write ('admin-override', from
  // scripts/update-laundry-address.js) is not the studio spending its own grant -
  // clearing it there would silently cancel a change the studio was about to make.
  it.each([['no-address-yet'], ['admin-override']])(
    'touches no metadata at all for reason %p',
    async reason => {
      const { integrationSdk, updateProfile } = setup();

      await writeLaundryAddress({
        integrationSdk,
        laundryId: LAUNDRY_ID,
        laundryProfile: {},
        address: NEW_ADDRESS,
        origin: NEW_ORIGIN,
        reason,
      });

      expect(updateProfile.mock.calls[0][0]).not.toHaveProperty('metadata');
    }
  );
});

const setupListings = (pages, { updateReject } = {}) => {
  const query = jest.fn(({ page = 1 }) =>
    Promise.resolve({
      data: { data: pages[page - 1] || [], meta: { totalPages: pages.length } },
    })
  );
  const update = jest.fn(params =>
    updateReject && updateReject(params)
      ? Promise.reject({ data: { errors: [{ code: 'nope' }] } })
      : Promise.resolve({ data: { data: {} } })
  );
  return { integrationSdk: { listings: { query, update } }, query, update };
};

const laundryRecord = {
  id: LAUNDRY_ID,
  displayName: 'Maison du Marais',
  studioName: 'Maison du Marais',
  address: NEW_ADDRESS,
  origin: NEW_ORIGIN,
};

describe('findListingsAssignedToLaundry()', () => {
  it('asks for every listing state, not just published', async () => {
    const { integrationSdk, query } = setupListings([[listingEntity()]]);
    await findListingsAssignedToLaundry({ integrationSdk, laundryId: LAUNDRY_ID });

    expect(query.mock.calls[0][0].states).toEqual(ALL_LISTING_STATES);
    expect(query.mock.calls[0][0].meta_assignedLaundryId).toBe(LAUNDRY_ID);
  });

  // THE FAIL-OPEN TEST, and the most important one in this file. The Integration API
  // silently IGNORES an unrecognised extended-data filter and returns the whole
  // marketplace (verified against Dev; it has already caused two security bugs in
  // this project). If the JS re-check were ever dropped, this function would hand
  // back every listing in the marketplace and the caller would rewrite all of their
  // pickup addresses to one studio's address.
  it('re-filters in JS, so a fail-open query cannot widen the result', async () => {
    const { integrationSdk } = setupListings([
      [
        listingEntity({ id: 'mine-1' }),
        listingEntity({ id: 'someone-elses', assignedLaundryId: OTHER_LAUNDRY_ID }),
        listingEntity({ id: 'unassigned', assignedLaundryId: null }),
        listingEntity({ id: 'mine-2', state: 'draft' }),
      ],
    ]);

    const { listings, scanned } = await findListingsAssignedToLaundry({
      integrationSdk,
      laundryId: LAUNDRY_ID,
    });

    expect(listings.map(l => l.id.uuid)).toEqual(['mine-1', 'mine-2']);
    expect(scanned).toBe(4);
  });

  // Without the id guard the JS comparison would be `undefined === undefined` for
  // every UNASSIGNED listing in the marketplace, turning the security filter into a
  // match-almost-everything filter.
  it('refuses to run without a laundry id rather than matching unassigned listings', async () => {
    const { integrationSdk, query } = setupListings([[listingEntity({ assignedLaundryId: null })]]);

    await expect(
      findListingsAssignedToLaundry({ integrationSdk, laundryId: undefined })
    ).rejects.toThrow(/requires a laundry user id/);
    expect(query).not.toHaveBeenCalled();
  });

  it('pages through every page', async () => {
    const { integrationSdk, query } = setupListings([
      [listingEntity({ id: 'p1' })],
      [listingEntity({ id: 'p2' })],
    ]);

    const { listings } = await findListingsAssignedToLaundry({
      integrationSdk,
      laundryId: LAUNDRY_ID,
    });

    expect(listings.map(l => l.id.uuid)).toEqual(['p1', 'p2']);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('propagateAddressToAssignedListings()', () => {
  it('writes pickupAddress, assignedLaundryName and geolocation on every assigned listing', async () => {
    const { integrationSdk, update } = setupListings([
      [listingEntity({ id: 'l1' }), listingEntity({ id: 'l2', state: 'draft' })],
    ]);

    const result = await propagateAddressToAssignedListings({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundry: laundryRecord,
    });

    expect(result.updated.map(entry => entry.id)).toEqual(['l1', 'l2']);
    expect(update).toHaveBeenCalledTimes(2);

    const params = update.mock.calls[0][0];
    expect(params.publicData.pickupAddress).toBe(NEW_ADDRESS);
    expect(params.publicData.assignedLaundryName).toBe('Maison du Marais');
    // `geolocation` is a top-level attribute, so it has to be an SDK LatLng and not
    // the plain object publicData carries.
    expect(params.geolocation.lat).toBe(NEW_ORIGIN.lat);
    expect(params.geolocation.lng).toBe(NEW_ORIGIN.lng);
    // The assignment itself is NOT re-stamped: a studio that moves does not
    // re-assign anybody's garment, and re-resolving initialCleaningDays would
    // resize the calendar block of a garment that may be mid-rental.
    expect(params).not.toHaveProperty('metadata');
  });

  it('never touches a listing assigned to a different laundry', async () => {
    const { integrationSdk, update } = setupListings([
      [
        listingEntity({ id: 'mine' }),
        listingEntity({ id: 'theirs', assignedLaundryId: OTHER_LAUNDRY_ID }),
      ],
    ]);

    const result = await propagateAddressToAssignedListings({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundry: laundryRecord,
    });

    expect(result.updated.map(entry => entry.id)).toEqual(['mine']);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].id.uuid).toBe('mine');
  });

  it('skips a listing that already carries the new address on every field', async () => {
    const { integrationSdk, update } = setupListings([
      [
        listingEntity({
          id: 'already-correct',
          publicData: {
            pickupAddress: NEW_ADDRESS,
            assignedLaundryName: 'Maison du Marais',
            // Part of the comparison now: it is a copy, so it can be stale, so "already
            // correct" has to include it. Without this the listing looks correct on the
            // other three and a studio that moved neighbourhoods never converges.
            assignedLaundryNeighborhood: null,
          },
          geolocation: NEW_ORIGIN,
        }),
        listingEntity({ id: 'stale' }),
      ],
    ]);

    const result = await propagateAddressToAssignedListings({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundry: laundryRecord,
    });

    expect(result.skipped.map(entry => entry.id)).toEqual(['already-correct']);
    expect(result.updated.map(entry => entry.id)).toEqual(['stale']);
    expect(update).toHaveBeenCalledTimes(1);
  });

  // A DRY RUN MUST WRITE NOTHING. This is the whole safety property of
  // scripts/update-laundry-address.js --dry-run.
  it('writes nothing at all in dry-run mode, but still reports what it would change', async () => {
    const { integrationSdk, update } = setupListings([
      [listingEntity({ id: 'l1' }), listingEntity({ id: 'l2' })],
    ]);

    const result = await propagateAddressToAssignedListings({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundry: laundryRecord,
      dryRun: true,
    });

    expect(update).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.updated.map(entry => entry.id)).toEqual(['l1', 'l2']);
  });

  // Stopping on the first failure would leave an arbitrary prefix of the studio's
  // garments updated with no record of where it stopped.
  it('carries on past a per-listing failure and reports it', async () => {
    const { integrationSdk, update } = setupListings(
      [
        [
          listingEntity({ id: 'ok-1' }),
          listingEntity({ id: 'bad' }),
          listingEntity({ id: 'ok-2' }),
        ],
      ],
      { updateReject: params => params.id.uuid === 'bad' }
    );

    const result = await propagateAddressToAssignedListings({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundry: laundryRecord,
    });

    expect(result.updated.map(entry => entry.id)).toEqual(['ok-1', 'ok-2']);
    expect(result.failed.map(entry => entry.id)).toEqual(['bad']);
    expect(update).toHaveBeenCalledTimes(3);
    // Never the bare error object - an axios error carries the bearer token in
    // `config.headers`.
    expect(result.failed[0].error).toEqual({ errors: [{ code: 'nope' }] });
  });
});

// ---------------------------------------------------------------------------
//   > "el vecindario tambien debe guardarse en el listing" (Jonathan, 2026-09-09)
//
// A copy is a thing that can go stale, so the moment the neighbourhood became a copy it also
// became something this propagation has to notice. The assertion that matters: a listing
// correct on the other three fields is NOT correct if this one has moved.
// ---------------------------------------------------------------------------
describe('propagateAddressToAssignedListings(): the neighbourhood', () => {
  it('re-stamps a listing whose only stale field is the neighbourhood', async () => {
    const { integrationSdk, update } = setupListings([
      [
        listingEntity({
          id: 'moved',
          geolocation: laundryRecord.origin,
          publicData: {
            pickupAddress: laundryRecord.address,
            assignedLaundryName: laundryRecord.studioName,
            assignedLaundryNeighborhood: 'Le Marais',
          },
        }),
      ],
    ]);

    const result = await propagateAddressToAssignedListings({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundry: { ...laundryRecord, neighborhood: 'Le Sentier' },
    });

    expect(result.updated.map(entry => entry.id)).toEqual(['moved']);
    expect(result.skipped).toHaveLength(0);
    expect(update.mock.calls[0][0].publicData.assignedLaundryNeighborhood).toBe('Le Sentier');
  });

  it('leaves a listing alone once its neighbourhood already matches', async () => {
    const { integrationSdk, update } = setupListings([
      [
        listingEntity({
          id: 'current',
          geolocation: laundryRecord.origin,
          publicData: {
            pickupAddress: laundryRecord.address,
            assignedLaundryName: laundryRecord.studioName,
            assignedLaundryNeighborhood: 'Le Sentier',
          },
        }),
      ],
    ]);

    const result = await propagateAddressToAssignedListings({
      integrationSdk,
      laundryId: LAUNDRY_ID,
      laundry: { ...laundryRecord, neighborhood: 'Le Sentier' },
    });

    expect(result.skipped.map(entry => entry.id)).toEqual(['current']);
    expect(update).not.toHaveBeenCalled();
  });
});
