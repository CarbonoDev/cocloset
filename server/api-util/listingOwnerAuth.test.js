jest.mock('./sdk', () => ({
  getSdk: jest.fn(),
}));

const { getSdk } = require('./sdk');

const {
  isListingAuthor,
  requireListingAuthorCaller,
  authorizeLaundryOrOwnerCaller,
} = require('./listingOwnerAuth');

// These tests are the point of this module. `onLaundry` is the only listing field
// two different principals may write, and both failure directions are quiet:
// letting the wrong laundry release custody of a garment it does not hold, or
// letting a garment owner drive a studio's inventory, would both look like a
// successful request. Nothing here asserts a happy path without also asserting
// the neighbouring denial.

const OWNER_ID = 'owner-1';
const LAUNDRY_ID = 'laundry-1';
const OTHER_LAUNDRY_ID = 'laundry-2';
const STRANGER_ID = 'stranger-1';

const listingEntity = ({ authorId = OWNER_ID, assignedLaundryId = LAUNDRY_ID } = {}) => ({
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: { publicData: { assignedLaundryId } },
  relationships: { author: { data: { id: { uuid: authorId }, type: 'user' } } },
});

const userEntity = ({ id, isLaundry }) => ({
  id: { uuid: id },
  type: 'currentUser',
  attributes: { profile: { metadata: isLaundry === undefined ? {} : { isLaundry } } },
});

// The caller's own cookie-scoped Marketplace SDK. Authorization must never read
// the caller's identity from anywhere else.
const mockCaller = currentUser => {
  const show = jest.fn(() => Promise.resolve({ data: { data: currentUser } }));
  getSdk.mockReturnValue({ currentUser: { show } });
  return show;
};

const mockNoSession = () => {
  const show = jest.fn(() => Promise.reject(new Error('Unauthorized')));
  getSdk.mockReturnValue({ currentUser: { show } });
  return show;
};

const req = {};
const res = {};

describe('isListingAuthor', () => {
  it('matches the listing author', () => {
    expect(isListingAuthor(userEntity({ id: OWNER_ID }), listingEntity())).toBe(true);
  });

  it('rejects anyone else', () => {
    expect(isListingAuthor(userEntity({ id: STRANGER_ID }), listingEntity())).toBe(false);
  });

  // Both of these would be an accidental "true" if the check were a loose
  // equality between two undefineds - which is exactly how this kind of bug ships.
  it('rejects a listing with no author relationship', () => {
    expect(isListingAuthor(userEntity({ id: OWNER_ID }), { id: { uuid: 'x' } })).toBe(false);
  });

  it('rejects a caller with no id', () => {
    expect(isListingAuthor({}, listingEntity())).toBe(false);
    expect(isListingAuthor(undefined, listingEntity())).toBe(false);
  });

  it('does not consult publicData, which the owner can write', () => {
    // A listing whose publicData claims the stranger owns it. The relationship
    // says otherwise, and the relationship is the only thing that counts.
    const listing = {
      ...listingEntity(),
      attributes: { publicData: { assignedLaundryId: LAUNDRY_ID, authorId: STRANGER_ID } },
    };
    expect(isListingAuthor(userEntity({ id: STRANGER_ID }), listing)).toBe(false);
  });
});

describe('requireListingAuthorCaller', () => {
  it('resolves with the currentUser for the listing author', async () => {
    mockCaller(userEntity({ id: OWNER_ID }));
    const currentUser = await requireListingAuthorCaller(req, res, listingEntity());
    expect(currentUser.id.uuid).toBe(OWNER_ID);
  });

  it('rejects a non-author with 403', async () => {
    mockCaller(userEntity({ id: STRANGER_ID }));
    await expect(requireListingAuthorCaller(req, res, listingEntity())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects a laundry that is not the owner, even the assigned one', async () => {
    // The assigned laundry has plenty of authority over this listing; being its
    // owner is not part of it. Assigning a laundry is the owner's decision.
    mockCaller(userEntity({ id: LAUNDRY_ID, isLaundry: true }));
    await expect(requireListingAuthorCaller(req, res, listingEntity())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('maps a failed session onto 401, not 500', async () => {
    mockNoSession();
    await expect(requireListingAuthorCaller(req, res, listingEntity())).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('authorizeLaundryOrOwnerCaller', () => {
  it('accepts the listing owner, as role owner', async () => {
    mockCaller(userEntity({ id: OWNER_ID }));
    await expect(authorizeLaundryOrOwnerCaller(req, res, listingEntity())).resolves.toMatchObject({
      role: 'owner',
    });
  });

  it('accepts the assigned laundry, as role laundry', async () => {
    mockCaller(userEntity({ id: LAUNDRY_ID, isLaundry: true }));
    await expect(authorizeLaundryOrOwnerCaller(req, res, listingEntity())).resolves.toMatchObject({
      role: 'laundry',
    });
  });

  it('rejects a DIFFERENT laundry with 403', async () => {
    // The dangerous one. A studio across town is a laundry user and would pass a
    // flag-only check; it has no business releasing custody of this garment.
    mockCaller(userEntity({ id: OTHER_LAUNDRY_ID, isLaundry: true }));
    await expect(authorizeLaundryOrOwnerCaller(req, res, listingEntity())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects an unflagged user who happens to hold the assigned laundry id', async () => {
    // isLaundry lives in operator-written metadata; a user who lost the flag has
    // lost the authority, whatever publicData still points at them.
    mockCaller(userEntity({ id: LAUNDRY_ID, isLaundry: false }));
    await expect(authorizeLaundryOrOwnerCaller(req, res, listingEntity())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects a stranger with 403', async () => {
    mockCaller(userEntity({ id: STRANGER_ID }));
    await expect(authorizeLaundryOrOwnerCaller(req, res, listingEntity())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects a listing with no assigned laundry, for a laundry caller', async () => {
    mockCaller(userEntity({ id: LAUNDRY_ID, isLaundry: true }));
    const listing = listingEntity({ assignedLaundryId: null });
    await expect(authorizeLaundryOrOwnerCaller(req, res, listing)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('accepts the owner of a listing with no assigned laundry', async () => {
    // A garment whose laundry was never set is still its owner's garment.
    mockCaller(userEntity({ id: OWNER_ID }));
    const listing = listingEntity({ assignedLaundryId: null });
    await expect(authorizeLaundryOrOwnerCaller(req, res, listing)).resolves.toMatchObject({
      role: 'owner',
    });
  });

  it('treats a laundry that owns the listing as its owner, not as an unassigned laundry', async () => {
    // A studio that also lists a garment of its own, assigned to a DIFFERENT
    // studio. Checking the laundry branch first would run the assigned-laundry
    // rule on them and lock them out of their own listing.
    mockCaller(userEntity({ id: OWNER_ID, isLaundry: true }));
    const listing = listingEntity({ authorId: OWNER_ID, assignedLaundryId: OTHER_LAUNDRY_ID });
    await expect(authorizeLaundryOrOwnerCaller(req, res, listing)).resolves.toMatchObject({
      role: 'owner',
    });
  });

  it('maps a failed session onto 401, not 500', async () => {
    mockNoSession();
    await expect(authorizeLaundryOrOwnerCaller(req, res, listingEntity())).rejects.toMatchObject({
      status: 401,
    });
  });

  it('asks the caller-scoped SDK exactly once', async () => {
    // Not a performance assertion: two currentUser.show() calls would mean two
    // independent authorization decisions on one request, which can disagree.
    const show = mockCaller(userEntity({ id: OWNER_ID }));
    await authorizeLaundryOrOwnerCaller(req, res, listingEntity());
    expect(show).toHaveBeenCalledTimes(1);
  });
});
