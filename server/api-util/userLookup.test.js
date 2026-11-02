const { normalizeEmail, assertUserMatchesEmail, findUserByEmail } = require('./userLookup');

const userEntity = (id, email) => ({
  id: { uuid: id },
  type: 'user',
  attributes: { email, profile: { displayName: 'Someone' } },
});

describe('normalizeEmail()', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  it('returns an empty string for non-strings', () => {
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(42)).toBe('');
  });
});

describe('assertUserMatchesEmail()', () => {
  it('returns the user when the email matches', () => {
    const user = userEntity('u1', 'test-laundry-cocloset@example.com');
    expect(assertUserMatchesEmail(user, 'test-laundry-cocloset@example.com')).toBe(user);
  });

  it('matches case-insensitively', () => {
    const user = userEntity('u1', 'Test-Laundry@Example.com');
    expect(assertUserMatchesEmail(user, 'test-laundry@example.com')).toBe(user);
  });

  // THE REGRESSION TEST FOR B2: users.query({ emailAddress }) is ignored and
  // returns an arbitrary user. If a lookup ever hands back the wrong person,
  // this must throw rather than let a role grant proceed.
  it('throws when the API returns a different user than was asked for', () => {
    const wrongUser = userEntity('tom', 'test-cocloset-tom-brady@example.com');
    expect(() => assertUserMatchesEmail(wrongUser, 'test-laundry-cocloset@example.com')).toThrow(
      /asked for test-laundry-cocloset@example\.com but the API returned/
    );
  });

  it('names both addresses and the id in the error, so the mismatch is diagnosable', () => {
    const wrongUser = userEntity('tom-uuid', 'tom@example.com');
    expect(() => assertUserMatchesEmail(wrongUser, 'laundry@example.com')).toThrow(/tom-uuid/);
  });

  it('throws when there is no user', () => {
    expect(() => assertUserMatchesEmail(undefined, 'a@example.com')).toThrow(
      /No user found with email a@example\.com/
    );
  });

  it('throws when the returned user carries no email to verify against', () => {
    expect(() => assertUserMatchesEmail({ id: { uuid: 'x' }, attributes: {} }, 'a@b.com')).toThrow(
      /cannot be verified/
    );
  });
});

describe('findUserByEmail()', () => {
  it('uses users.show({ email }), not users.query', () => {
    const show = jest.fn(() =>
      Promise.resolve({ data: { data: userEntity('u1', 'a@example.com') } })
    );
    const query = jest.fn();
    const sdk = { users: { show, query } };

    return findUserByEmail(sdk, 'a@example.com').then(user => {
      expect(show).toHaveBeenCalledWith({ email: 'a@example.com' });
      expect(query).not.toHaveBeenCalled();
      expect(user.id.uuid).toBe('u1');
    });
  });

  it('rejects when show returns someone else', () => {
    const sdk = {
      users: {
        show: () => Promise.resolve({ data: { data: userEntity('tom', 'tom@example.com') } }),
      },
    };
    return expect(findUserByEmail(sdk, 'laundry@example.com')).rejects.toThrow(
      /Refusing to continue/
    );
  });
});
