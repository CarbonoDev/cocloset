const {
  isLaundryUserEntity,
  toLaundryDirectoryEntry,
  hasUsableLaundryProfile,
  buildLaundryDirectory,
} = require('./laundryDirectory');

// Minimal `user` API-entity factory, matching the shape users.query returns.
const userEntity = (
  id,
  {
    isLaundry,
    displayName,
    laundryProfile,
    acceptedCategories,
    turnaroundHours,
    cleaningFee,
    categoryPricing,
  } = {}
) => ({
  id: { uuid: id },
  type: 'user',
  attributes: {
    profile: {
      displayName,
      publicData: {
        ...(laundryProfile ? { laundryProfile } : {}),
        ...(acceptedCategories ? { acceptedCategories } : {}),
        // A key that must never reach the response: proves the endpoint
        // allowlists rather than spreading publicData.
        someUnrelatedPublicKey: 'should-not-be-exposed',
      },
      privateData: {
        ...(turnaroundHours !== undefined ? { turnaroundHours } : {}),
        // cleaningFee is a server-side pricing input, never sent to the picker.
        ...(cleaningFee !== undefined ? { cleaningFee } : {}),
        // Neither is the per-category table, which holds per-category FEES alongside
        // the hours. Only ONE resolved hours number may ever leave this module.
        ...(categoryPricing !== undefined ? { categoryPricing } : {}),
      },
      ...(isLaundry === undefined ? {} : { metadata: { isLaundry } }),
    },
  },
});

const completeProfile = {
  studioName: 'Studio Pigalle',
  address: '12 Rue Pigalle, Paris',
  origin: { lat: 48.8821, lng: 2.3372 },
  businessHours: 'Mon-Fri 9-18',
};

describe('isLaundryUserEntity()', () => {
  it('is true only for metadata.isLaundry === true', () => {
    expect(isLaundryUserEntity(userEntity('a', { isLaundry: true }))).toBe(true);
  });

  it('is false for a user with no metadata at all', () => {
    expect(isLaundryUserEntity(userEntity('b'))).toBe(false);
  });

  it('is false for isLaundry: false', () => {
    expect(isLaundryUserEntity(userEntity('c', { isLaundry: false }))).toBe(false);
  });

  it('is false for truthy-but-not-true values (no loose coercion)', () => {
    expect(isLaundryUserEntity(userEntity('d', { isLaundry: 'true' }))).toBe(false);
    expect(isLaundryUserEntity(userEntity('e', { isLaundry: 1 }))).toBe(false);
  });

  it('does not throw on malformed entities', () => {
    expect(isLaundryUserEntity(undefined)).toBe(false);
    expect(isLaundryUserEntity({})).toBe(false);
    expect(isLaundryUserEntity({ attributes: {} })).toBe(false);
  });
});

describe('toLaundryDirectoryEntry()', () => {
  it('maps the allowlisted fields onto a flat record', () => {
    const entry = toLaundryDirectoryEntry(
      userEntity('laundry-1', {
        isLaundry: true,
        displayName: 'Pigalle Pressing',
        laundryProfile: completeProfile,
        acceptedCategories: ['dresses', 'coats'],
        turnaroundHours: 36,
      })
    );

    expect(entry).toEqual({
      id: 'laundry-1',
      displayName: 'Pigalle Pressing',
      studioName: 'Studio Pigalle',
      address: '12 Rue Pigalle, Paris',
      origin: { lat: 48.8821, lng: 2.3372 },
      businessHours: 'Mon-Fri 9-18',
      acceptedCategories: ['dresses', 'coats'],
      turnaroundHours: 36,
      // No garment chain was passed, so this is the studio-wide number and the card
      // must not claim otherwise.
      turnaroundHoursIsCategorySpecific: false,
    });
  });

  it('never leaks unrelated publicData keys or the cleaning fee', () => {
    const entry = toLaundryDirectoryEntry(
      userEntity('laundry-1', {
        isLaundry: true,
        laundryProfile: completeProfile,
        turnaroundHours: 24,
        cleaningFee: 42,
      })
    );

    expect(Object.keys(entry).sort()).toEqual([
      'acceptedCategories',
      'address',
      'businessHours',
      'displayName',
      'id',
      'origin',
      'studioName',
      'turnaroundHours',
      'turnaroundHoursIsCategorySpecific',
    ]);
    expect(JSON.stringify(entry)).not.toContain('should-not-be-exposed');
    expect(JSON.stringify(entry)).not.toContain('42');
  });

  it('never leaks PER-CATEGORY cleaning fees, even while resolving hours from that table', () => {
    // The whole reason turnaround is resolved server-side instead of shipping
    // `categoryPricing` to the browser: the same table holds the studio's fee list.
    // One resolved number goes out; the price list does not.
    const entry = toLaundryDirectoryEntry(
      userEntity('laundry-1', {
        isLaundry: true,
        laundryProfile: completeProfile,
        turnaroundHours: 24,
        categoryPricing: {
          dresses: { turnaroundHours: 72, cleaningFee: 999 },
          midi_dress: { cleaningFee: 777 },
        },
      }),
      ['dresses', 'midi_dress']
    );

    expect(entry.turnaroundHours).toBe(72);
    expect(JSON.stringify(entry)).not.toContain('999');
    expect(JSON.stringify(entry)).not.toContain('777');
    expect(JSON.stringify(entry)).not.toContain('cleaningFee');
  });

  it('resolves turnaround for the garment being assigned, from its TOP-LEVEL category', () => {
    const user = userEntity('l', {
      isLaundry: true,
      laundryProfile: completeProfile,
      turnaroundHours: 24,
      categoryPricing: { dresses: { turnaroundHours: 72 }, midi_dress: { turnaroundHours: 6 } },
    });

    // Hours are configured "por categoría grande", so the subcategory entry is inert
    // and the top-level 72 is what this garment gets.
    const entry = toLaundryDirectoryEntry(user, ['dresses', 'midi_dress']);
    expect(entry.turnaroundHours).toBe(72);
    expect(entry.turnaroundHoursIsCategorySpecific).toBe(true);
  });

  it('falls back to the studio-wide number when the garment category has no entry', () => {
    const entry = toLaundryDirectoryEntry(
      userEntity('l', {
        isLaundry: true,
        laundryProfile: completeProfile,
        turnaroundHours: 24,
        categoryPricing: { dresses: { turnaroundHours: 72 } },
      }),
      ['pants']
    );

    expect(entry.turnaroundHours).toBe(24);
    // False, so the card says "Turnaround: 24h" rather than promising 24h for pants
    // specifically. A studio-wide number is not a per-category commitment.
    expect(entry.turnaroundHoursIsCategorySpecific).toBe(false);
  });

  it('keeps the studio-wide number when no garment chain is passed at all', () => {
    // The pre-existing call shape. Callers that do not know the garment (or predate
    // the parameter) get exactly what they always got.
    const entry = toLaundryDirectoryEntry(
      userEntity('l', {
        isLaundry: true,
        laundryProfile: completeProfile,
        turnaroundHours: 24,
        categoryPricing: { dresses: { turnaroundHours: 72 } },
      })
    );

    expect(entry.turnaroundHours).toBe(24);
    expect(entry.turnaroundHoursIsCategorySpecific).toBe(false);
  });

  it('still coerces a STRING studio-wide turnaround when a garment chain is passed', () => {
    // The pure resolver deliberately rejects strings; parseTurnaroundHours does not.
    // Passing a category must not make a Console-written '36' vanish from the card.
    const entry = toLaundryDirectoryEntry(
      userEntity('l', { isLaundry: true, laundryProfile: completeProfile, turnaroundHours: '36' }),
      ['dresses']
    );

    expect(entry.turnaroundHours).toBe(36);
    expect(entry.turnaroundHoursIsCategorySpecific).toBe(false);
  });

  it('coerces a string turnaroundHours to a number (Console/API can store a string)', () => {
    const entry = toLaundryDirectoryEntry(
      userEntity('l', { isLaundry: true, laundryProfile: completeProfile, turnaroundHours: '36' })
    );
    expect(entry.turnaroundHours).toBe(36);
  });

  it('nulls out a non-positive or unparseable turnaroundHours', () => {
    const mk = v =>
      toLaundryDirectoryEntry(
        userEntity('l', { isLaundry: true, laundryProfile: completeProfile, turnaroundHours: v })
      ).turnaroundHours;
    expect(mk(0)).toBeNull();
    expect(mk(-5)).toBeNull();
    expect(mk('soon')).toBeNull();
    expect(mk(undefined)).toBeNull();
  });

  it('nulls out an origin that is not a real coordinate pair', () => {
    const mk = origin =>
      toLaundryDirectoryEntry(
        userEntity('l', { isLaundry: true, laundryProfile: { ...completeProfile, origin } })
      ).origin;
    expect(mk(undefined)).toBeNull();
    expect(mk({})).toBeNull();
    expect(mk({ lat: 1 })).toBeNull();
    expect(mk({ lat: '48.8', lng: '2.3' })).toBeNull();
    expect(mk({ lat: NaN, lng: 2 })).toBeNull();
  });

  it('defaults acceptedCategories to an array', () => {
    const entry = toLaundryDirectoryEntry(userEntity('l', { isLaundry: true }));
    expect(entry.acceptedCategories).toEqual([]);
  });
});

describe('hasUsableLaundryProfile()', () => {
  it('accepts an entry with an id, an address and an origin', () => {
    expect(hasUsableLaundryProfile({ id: 'x', address: 'a', origin: { lat: 1, lng: 2 } })).toBe(
      true
    );
  });

  it('rejects an entry with no origin — assigning it would block publishing', () => {
    expect(hasUsableLaundryProfile({ id: 'x', address: 'a', origin: null })).toBe(false);
  });

  it('rejects an entry with no address', () => {
    expect(hasUsableLaundryProfile({ id: 'x', address: null, origin: { lat: 1, lng: 2 } })).toBe(
      false
    );
  });
});

describe('buildLaundryDirectory()', () => {
  // THE REGRESSION TEST FOR B1. The Integration API's `meta_isLaundry` filter
  // is silently ignored, so `users.query` hands us the whole marketplace. If
  // the JS-side filter ever regresses, this fails loudly on the negative case.
  it('drops every non-laundry user handed to it', () => {
    const users = [
      userEntity('tom-brady', { displayName: 'Tom Brady' }),
      userEntity('the-laundry', {
        isLaundry: true,
        displayName: 'Pigalle Pressing',
        laundryProfile: completeProfile,
      }),
      userEntity('explicitly-not', { isLaundry: false, displayName: 'Not A Laundry' }),
      userEntity('sneaky-string', { isLaundry: 'true', displayName: 'Spoofed' }),
    ];

    const { laundries, meta } = buildLaundryDirectory(users);

    expect(laundries).toHaveLength(1);
    expect(laundries[0].id).toBe('the-laundry');
    expect(laundries.map(l => l.displayName)).not.toContain('Tom Brady');
    expect(laundries.map(l => l.displayName)).not.toContain('Not A Laundry');
    expect(laundries.map(l => l.displayName)).not.toContain('Spoofed');
    expect(meta).toEqual({
      totalUsersScanned: 4,
      laundryUserCount: 1,
      incompleteProfileCount: 0,
    });
  });

  it('returns an empty list when the marketplace has no flagged laundries', () => {
    const users = [userEntity('a'), userEntity('b'), userEntity('c', { isLaundry: false })];
    expect(buildLaundryDirectory(users)).toEqual({
      laundries: [],
      meta: { totalUsersScanned: 3, laundryUserCount: 0, incompleteProfileCount: 0 },
    });
  });

  it('omits a flagged laundry that never set up a profile, and counts it', () => {
    const users = [
      userEntity('ready', { isLaundry: true, laundryProfile: completeProfile }),
      userEntity('never-onboarded', { isLaundry: true, displayName: 'Blank Laundry' }),
      userEntity('no-origin', {
        isLaundry: true,
        laundryProfile: { studioName: 'X', address: 'somewhere' },
      }),
    ];

    const { laundries, meta } = buildLaundryDirectory(users);

    expect(laundries.map(l => l.id)).toEqual(['ready']);
    expect(meta).toEqual({
      totalUsersScanned: 3,
      laundryUserCount: 3,
      incompleteProfileCount: 2,
    });
  });

  it('tolerates a missing/garbage user list', () => {
    expect(buildLaundryDirectory(undefined).laundries).toEqual([]);
    expect(buildLaundryDirectory(null).laundries).toEqual([]);
    expect(buildLaundryDirectory([]).laundries).toEqual([]);
  });

  it('forwards the garment category chain to every entry', () => {
    // Guards a specific trap: `users.map(toLaundryDirectoryEntry)` would hand
    // Array#map's INDEX in as the second argument, so every card would silently
    // resolve against `0` and fall back to the studio-wide number — with no error,
    // and looking exactly like a laundry that had configured nothing.
    const users = [
      userEntity('a', {
        isLaundry: true,
        laundryProfile: completeProfile,
        turnaroundHours: 24,
        categoryPricing: { dresses: { turnaroundHours: 72 } },
      }),
      userEntity('b', {
        isLaundry: true,
        laundryProfile: completeProfile,
        turnaroundHours: 24,
        categoryPricing: { dresses: { turnaroundHours: 12 } },
      }),
    ];

    const { laundries } = buildLaundryDirectory(users, ['dresses', 'midi_dress']);

    expect(laundries.map(l => l.turnaroundHours)).toEqual([72, 12]);
    expect(laundries.every(l => l.turnaroundHoursIsCategorySpecific)).toBe(true);
  });
});
