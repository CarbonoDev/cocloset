import {
  canChangeLaundryAddress,
  hasUsableLaundryAddress,
  hasUsableLaundryAddressForUser,
  isLaundryAddressChangeAllowed,
} from './laundryProfile';

// The real server rules, imported for the parity tests below. TEST-ONLY imports:
// server/api-util is CommonJS and must never reach the browser bundle, which is
// why laundryProfile.js holds twins rather than re-exports.
const {
  hasUsableLaundryProfile,
  toLaundryDirectoryEntry,
} = require('../../server/api-util/laundryDirectory');
const {
  evaluateAddressChange,
  readAddressChangeAllowed,
} = require('../../server/api-util/laundryAddress');

// Every case that matters, expressed once. Used by both describe blocks so the
// twin and the original are compared on identical input.
const CASES = [
  {
    name: 'a complete profile',
    laundryProfile: { address: '21 Rue Frochot', origin: { lat: 48.8, lng: 2.3 } },
    usable: true,
  },
  { name: 'no laundryProfile at all', laundryProfile: undefined, usable: false },
  { name: 'an empty laundryProfile', laundryProfile: {}, usable: false },
  {
    name: 'an address with no origin',
    laundryProfile: { address: '21 Rue Frochot' },
    usable: false,
  },
  {
    name: 'an origin with no address',
    laundryProfile: { origin: { lat: 48.8, lng: 2.3 } },
    usable: false,
  },
  {
    name: 'an empty-string address',
    laundryProfile: { address: '', origin: { lat: 48.8, lng: 2.3 } },
    usable: false,
  },
  {
    name: 'a half-filled origin',
    laundryProfile: { address: '21 Rue Frochot', origin: { lat: 48.8 } },
    usable: false,
  },
  {
    name: 'a stringly-typed origin',
    laundryProfile: { address: '21 Rue Frochot', origin: { lat: '48.8', lng: '2.3' } },
    usable: false,
  },
  {
    name: 'a NaN origin',
    laundryProfile: { address: '21 Rue Frochot', origin: { lat: NaN, lng: 2.3 } },
    usable: false,
  },
  {
    name: 'an origin at 0,0',
    laundryProfile: { address: 'Null Island', origin: { lat: 0, lng: 0 } },
    usable: true,
  },
];

describe('hasUsableLaundryAddress()', () => {
  CASES.forEach(({ name, laundryProfile, usable }) => {
    it(`${usable ? 'accepts' : 'rejects'} ${name}`, () => {
      expect(hasUsableLaundryAddress(laundryProfile)).toBe(usable);
    });
  });
});

describe('hasUsableLaundryAddressForUser()', () => {
  it('reads through a user entity', () => {
    const user = {
      id: { uuid: 'laundry-1' },
      attributes: {
        profile: {
          publicData: {
            laundryProfile: { address: '21 Rue Frochot', origin: { lat: 48.8, lng: 2.3 } },
          },
        },
      },
    };
    expect(hasUsableLaundryAddressForUser(user)).toBe(true);
  });

  it('tolerates a missing / not-yet-loaded user', () => {
    expect(hasUsableLaundryAddressForUser(undefined)).toBe(false);
    expect(hasUsableLaundryAddressForUser({})).toBe(false);
    expect(hasUsableLaundryAddressForUser({ attributes: { profile: {} } })).toBe(false);
  });
});

// THE DRIFT GUARD. The alert on LaundryProfilePage exists to explain why the
// SERVER is excluding a studio. If the client's notion of "usable" ever diverges
// from the server's, the studio is told the wrong thing about its own visibility
// — the exact failure mode the alert was added to fix, one level up. So the twin
// is checked against the real thing rather than against a remembered copy of it.
describe('parity with the server rule (server/api-util/laundryDirectory.js)', () => {
  CASES.forEach(({ name, laundryProfile }) => {
    it(`agrees with hasUsableLaundryProfile for ${name}`, () => {
      const userEntity = {
        id: { uuid: 'laundry-1' },
        attributes: {
          profile: { metadata: { isLaundry: true }, publicData: { laundryProfile } },
        },
      };
      const serverSaysUsable = hasUsableLaundryProfile(toLaundryDirectoryEntry(userEntity));

      expect(hasUsableLaundryAddress(laundryProfile)).toBe(serverSaysUsable);
    });
  });
});

// A user entity carrying an arbitrary metadata value for the permission flag.
const userWithFlag = (laundryProfile, addressChangeAllowed) => ({
  id: { uuid: 'laundry-1' },
  attributes: {
    profile: {
      displayName: 'Pigalle Pressing',
      metadata: { isLaundry: true, addressChangeAllowed },
      publicData: { laundryProfile },
    },
  },
});

describe('isLaundryAddressChangeAllowed()', () => {
  it('is true only for a real boolean true', () => {
    expect(isLaundryAddressChangeAllowed(userWithFlag({}, true))).toBe(true);
  });

  // A flag that a string, a 1 or an object could satisfy is not a permission.
  it.each([['true'], [1], [{}], [false], [null], [undefined]])(
    'is false for %p',
    untrustedValue => {
      expect(isLaundryAddressChangeAllowed(userWithFlag({}, untrustedValue))).toBe(false);
    }
  );

  it('tolerates a missing / not-yet-loaded user', () => {
    expect(isLaundryAddressChangeAllowed(undefined)).toBe(false);
    expect(isLaundryAddressChangeAllowed({ attributes: { profile: {} } })).toBe(false);
  });
});

const COMPLETE_PROFILE = { address: '21 Rue Frochot', origin: { lat: 48.8, lng: 2.3 } };

describe('canChangeLaundryAddress()', () => {
  // ONBOARDING MUST ALWAYS WORK. A permanently disabled empty field would strand
  // every new studio: it is invisible in the picker until it has an address, and it
  // cannot get one without this.
  it('allows a studio that has no address yet, with no grant', () => {
    expect(canChangeLaundryAddress(userWithFlag({}, undefined))).toBe(true);
  });

  // The trap the alert also has to cover: an address string with no geocoded
  // origin is excluded by the server exactly as hard as no address at all, so it
  // is still onboarding and must stay editable.
  it('allows a studio with an address but no usable origin', () => {
    expect(canChangeLaundryAddress(userWithFlag({ address: '21 Rue Frochot' }, undefined))).toBe(
      true
    );
  });

  it('refuses a studio with a usable address and no grant', () => {
    expect(canChangeLaundryAddress(userWithFlag(COMPLETE_PROFILE, undefined))).toBe(false);
  });

  it('allows a studio with a usable address once an admin has granted the change', () => {
    expect(canChangeLaundryAddress(userWithFlag(COMPLETE_PROFILE, true))).toBe(true);
  });

  it('does not accept a truthy non-boolean grant', () => {
    expect(canChangeLaundryAddress(userWithFlag(COMPLETE_PROFILE, 'true'))).toBe(false);
    expect(canChangeLaundryAddress(userWithFlag(COMPLETE_PROFILE, 1))).toBe(false);
  });
});

// THE SECOND DRIFT GUARD. The form's lock and the endpoint's 403 have to be the
// same rule: a form that allows what the server refuses produces a studio that
// edits, saves, and is told no; a form that refuses what the server allows is a
// studio that cannot onboard.
describe('parity with the server rule (server/api-util/laundryAddress.js)', () => {
  const FLAG_VALUES = [true, false, undefined, null, 'true', 1, {}];
  const PROFILES = [
    ['a complete profile', COMPLETE_PROFILE],
    ['no address at all', {}],
    ['an address with no origin', { address: '21 Rue Frochot' }],
    ['a stringly-typed origin', { address: '21 Rue Frochot', origin: { lat: '48.8', lng: '2.3' } }],
  ];

  PROFILES.forEach(([profileName, laundryProfile]) => {
    FLAG_VALUES.forEach(flag => {
      it(`agrees with evaluateAddressChange for ${profileName} + flag ${JSON.stringify(
        flag
      )}`, () => {
        const userEntity = userWithFlag(laundryProfile, flag);
        const serverDecision = evaluateAddressChange({
          hasUsableStoredAddress: hasUsableLaundryProfile(toLaundryDirectoryEntry(userEntity)),
          addressChangeAllowed: readAddressChangeAllowed(userEntity),
        });

        expect(canChangeLaundryAddress(userEntity)).toBe(serverDecision.allowed);
        expect(isLaundryAddressChangeAllowed(userEntity)).toBe(
          readAddressChangeAllowed(userEntity)
        );
      });
    });
  });
});
