const {
  LAUNDRY_ROLE_KEY,
  needsLaundryRoleDefault,
  ensureLaundryRoleDefault,
} = require('./laundryRoleDefaults');

const USER_ID = 'user-1';

// Minimal Integration SDK double. `showMetadata` is what users.show reports as
// the target user's existing `profile.metadata`.
const mockIntegrationSdk = (showMetadata, { showRejects = false } = {}) => {
  const updateProfile = jest.fn(params =>
    Promise.resolve({
      data: {
        data: {
          id: { uuid: USER_ID },
          attributes: { profile: { metadata: { ...showMetadata, ...params.metadata } } },
        },
      },
    })
  );
  const show = jest.fn(() =>
    showRejects
      ? Promise.reject(new Error('users.show failed'))
      : Promise.resolve({
          data: {
            data: { id: { uuid: USER_ID }, attributes: { profile: { metadata: showMetadata } } },
          },
        })
  );
  return { users: { show, updateProfile } };
};

describe('needsLaundryRoleDefault', () => {
  it('is true when the key is absent (a brand new user is `metadata: {}`)', () => {
    expect(needsLaundryRoleDefault({})).toBe(true);
  });

  it('is true when there is no metadata object at all', () => {
    expect(needsLaundryRoleDefault(undefined)).toBe(true);
    expect(needsLaundryRoleDefault(null)).toBe(true);
  });

  it('is true when the key is present but null/undefined', () => {
    expect(needsLaundryRoleDefault({ isLaundry: null })).toBe(true);
    expect(needsLaundryRoleDefault({ isLaundry: undefined })).toBe(true);
  });

  it('is FALSE when the user is already flagged as a laundry', () => {
    expect(needsLaundryRoleDefault({ isLaundry: true })).toBe(false);
  });

  it('is false when the default has already been applied', () => {
    expect(needsLaundryRoleDefault({ isLaundry: false })).toBe(false);
  });

  it('leaves unexpected existing values alone rather than overwriting them', () => {
    expect(needsLaundryRoleDefault({ isLaundry: 'true' })).toBe(false);
    expect(needsLaundryRoleDefault({ isLaundry: 0 })).toBe(false);
  });

  it('ignores other metadata keys', () => {
    expect(needsLaundryRoleDefault({ somethingElse: true })).toBe(true);
  });
});

describe('ensureLaundryRoleDefault', () => {
  it('writes isLaundry = false when the key is absent', () => {
    const sdk = mockIntegrationSdk({});

    return ensureLaundryRoleDefault(sdk, USER_ID).then(result => {
      expect(sdk.users.updateProfile).toHaveBeenCalledTimes(1);
      expect(sdk.users.updateProfile.mock.calls[0][0]).toEqual({
        id: USER_ID,
        metadata: { isLaundry: false },
      });
      expect(result).toEqual({
        userId: USER_ID,
        isLaundry: false,
        updated: true,
        reason: 'defaulted',
      });
    });
  });

  // THE REGRESSION TEST THAT MATTERS. This endpoint runs with full-admin
  // credentials and is triggered by the client, so a naive "always write false"
  // would silently strip the laundry role - and with it the ability to advance
  // transactions and set the cleaning fee - from any user an admin promoted.
  it('does NOT demote a user who is already isLaundry = true', () => {
    const sdk = mockIntegrationSdk({ isLaundry: true });

    return ensureLaundryRoleDefault(sdk, USER_ID).then(result => {
      expect(sdk.users.updateProfile).not.toHaveBeenCalled();
      expect(result).toEqual({
        userId: USER_ID,
        isLaundry: true,
        updated: false,
        reason: 'already-set',
      });
    });
  });

  it('is a no-op (idempotent) when the default has already been applied', () => {
    const sdk = mockIntegrationSdk({ isLaundry: false });

    return ensureLaundryRoleDefault(sdk, USER_ID).then(result => {
      expect(sdk.users.updateProfile).not.toHaveBeenCalled();
      expect(result.updated).toBe(false);
      expect(result.reason).toBe('already-set');
    });
  });

  it('never writes a value other than false, and never another metadata key', () => {
    const sdk = mockIntegrationSdk({});

    return ensureLaundryRoleDefault(sdk, USER_ID).then(() => {
      const written = sdk.users.updateProfile.mock.calls[0][0].metadata;
      expect(Object.keys(written)).toEqual([LAUNDRY_ROLE_KEY]);
      expect(written[LAUNDRY_ROLE_KEY]).toBe(false);
    });
  });

  it('writes only to the id it was given', () => {
    const sdk = mockIntegrationSdk({});

    return ensureLaundryRoleDefault(sdk, USER_ID).then(() => {
      expect(sdk.users.show.mock.calls[0][0]).toEqual({ id: USER_ID });
      expect(sdk.users.updateProfile.mock.calls[0][0].id).toBe(USER_ID);
    });
  });

  it('accepts a UUID-shaped id and reports its uuid', () => {
    const sdk = mockIntegrationSdk({});
    const uuid = { uuid: USER_ID };

    return ensureLaundryRoleDefault(sdk, uuid).then(result => {
      expect(sdk.users.updateProfile.mock.calls[0][0].id).toBe(uuid);
      expect(result.userId).toBe(USER_ID);
    });
  });

  it('rejects without writing when no user id is given', () => {
    const sdk = mockIntegrationSdk({});

    return ensureLaundryRoleDefault(sdk, null).then(
      () => {
        throw new Error('should not resolve');
      },
      e => {
        expect(e.message).toMatch(/missing userId/);
        expect(sdk.users.show).not.toHaveBeenCalled();
        expect(sdk.users.updateProfile).not.toHaveBeenCalled();
      }
    );
  });

  // If the "does this user already have a value?" read fails we cannot know
  // whether writing would demote someone - so we must not write at all.
  it('does not write when the current value cannot be read', () => {
    const sdk = mockIntegrationSdk({}, { showRejects: true });

    return ensureLaundryRoleDefault(sdk, USER_ID).then(
      () => {
        throw new Error('should not resolve');
      },
      () => {
        expect(sdk.users.updateProfile).not.toHaveBeenCalled();
      }
    );
  });
});
