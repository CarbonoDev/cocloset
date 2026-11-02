jest.mock('../../util/api', () => ({
  updateLaundryAddress: jest.fn(),
}));

// user.duck's fetchCurrentUser makes SDK calls this file has no interest in; what
// matters is only THAT the profile is refreshed after a successful address change,
// because the form's lock and alert are both derived from currentUser.
jest.mock('../../ducks/user.duck', () => ({
  fetchCurrentUser: jest.fn(() => ({ type: 'user/fetchCurrentUser/mocked' })),
  setCurrentUser: jest.fn(user => ({ type: 'user/setCurrentUser/mocked', payload: user })),
}));

import { updateLaundryAddress as updateLaundryAddressApi } from '../../util/api';
import { fetchCurrentUser } from '../../ducks/user.duck';

import reducer, {
  updateProfile,
  updateProfileThunk,
  updateLaundryAddressThunk,
  uploadImageThunk,
} from './LaundryProfilePage.duck';

const ADDRESS = '5 Rue des Rosiers, 75004 Paris';
const ORIGIN = { lat: 48.857, lng: 2.359 };

const PROFILE = { publicData: { laundryProfile: { studioName: 'Studio Pigalle' } } };

// A minimal thunk harness. `sdk` is the `extra` argument createAsyncThunk passes on,
// which is where this duck's currentUser.updateProfile lives.
const harness = ({ updateProfileResult } = {}) => {
  const dispatched = [];
  const sdkUpdateProfile = jest.fn(() =>
    updateProfileResult === 'reject'
      ? Promise.reject(Object.assign(new Error('nope'), { status: 500 }))
      : Promise.resolve({
          data: {
            data: { id: { uuid: 'laundry-1' }, type: 'currentUser', attributes: { profile: {} } },
          },
        })
  );
  const sdk = { currentUser: { updateProfile: sdkUpdateProfile } };

  // Redux-thunk in miniature: a function action is invoked, anything else recorded.
  const dispatch = action =>
    typeof action === 'function'
      ? action(dispatch, () => ({}), sdk)
      : (dispatched.push(action), action);

  return { dispatch, dispatched, sdkUpdateProfile };
};

beforeEach(() => {
  updateLaundryAddressApi.mockReset();
  fetchCurrentUser.mockClear();
});

describe('updateProfile()', () => {
  // THE ORDER IS LOAD-BEARING. Both writes touch `publicData.laundryProfile`, which is
  // ONE top-level extended-data key holding a nested object, so each write replaces the
  // whole object. The profile write carries the STORED address and the address endpoint
  // read-modify-writes on top of it, so profile-then-address converges on "new studio
  // name + new address". The reverse order would stamp the old address back over the new.
  it('saves the profile first, then the address', async () => {
    updateLaundryAddressApi.mockReturnValue(Promise.resolve({ data: {} }));
    const { dispatch, sdkUpdateProfile } = harness();
    const callOrder = [];
    sdkUpdateProfile.mockImplementation(() => {
      callOrder.push('profile');
      return Promise.resolve({
        data: { data: { id: { uuid: 'l1' }, type: 'currentUser', attributes: { profile: {} } } },
      });
    });
    updateLaundryAddressApi.mockImplementation(() => {
      callOrder.push('address');
      return Promise.resolve({ data: {} });
    });

    await dispatch(updateProfile(PROFILE, { address: ADDRESS, origin: ORIGIN }));

    expect(callOrder).toEqual(['profile', 'address']);
    expect(updateLaundryAddressApi).toHaveBeenCalledWith({ address: ADDRESS, origin: ORIGIN });
  });

  it('makes no address call when there is no address change', async () => {
    const { dispatch, sdkUpdateProfile } = harness();

    await dispatch(updateProfile(PROFILE, null));

    expect(sdkUpdateProfile).toHaveBeenCalledTimes(1);
    expect(updateLaundryAddressApi).not.toHaveBeenCalled();
  });

  // A partial save that moved the address anyway would be worse than no save: the
  // studio would be left with its old studio name at its new address, and the grant
  // would already be spent.
  it('skips the address call when the profile save failed', async () => {
    const { dispatch } = harness({ updateProfileResult: 'reject' });

    await dispatch(updateProfile(PROFILE, { address: ADDRESS, origin: ORIGIN }));

    expect(updateLaundryAddressApi).not.toHaveBeenCalled();
  });
});

describe('updateLaundryAddressThunk()', () => {
  // The server has just spent the one-off grant and stored the new address. Without
  // the refresh the form keeps rendering the old currentUser - i.e. an unlocked
  // address field for a grant that no longer exists.
  it('re-fetches the current user after a successful change', async () => {
    updateLaundryAddressApi.mockReturnValue(Promise.resolve({ data: {} }));
    const { dispatch } = harness();

    await dispatch(updateLaundryAddressThunk({ address: ADDRESS, origin: ORIGIN }));

    expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('sends only lat/lng, never a whole SDK LatLng instance or extra keys', async () => {
    updateLaundryAddressApi.mockReturnValue(Promise.resolve({ data: {} }));
    const { dispatch } = harness();

    await dispatch(
      updateLaundryAddressThunk({
        address: ADDRESS,
        origin: { lat: 48.857, lng: 2.359, bounds: 'should not be sent' },
      })
    );

    expect(updateLaundryAddressApi).toHaveBeenCalledWith({
      address: ADDRESS,
      origin: { lat: 48.857, lng: 2.359 },
    });
  });

  // `storableError` keeps only `data.errors`, so the endpoint's `data.code` would be
  // thrown away - and that code is what lets the form show the translated "ask
  // support" message instead of a generic failure.
  it('keeps the server error code on the rejected payload', async () => {
    const serverError = Object.assign(new Error('refused'), {
      status: 403,
      statusText: 'refused',
      data: { code: 'change-not-allowed' },
    });
    updateLaundryAddressApi.mockReturnValue(Promise.reject(serverError));
    const { dispatch } = harness();

    const action = await dispatch(updateLaundryAddressThunk({ address: ADDRESS, origin: ORIGIN }));

    expect(action.payload.code).toBe('change-not-allowed');
    expect(action.payload.status).toBe(403);
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });
});

describe('reducer', () => {
  const initial = reducer(undefined, { type: '@@INIT' });

  it('tracks the address call separately from the profile call', () => {
    expect(initial.updateAddressInProgress).toBe(false);
    expect(initial.updateAddressError).toBeNull();

    const pending = reducer(initial, updateLaundryAddressThunk.pending('req'));
    expect(pending.updateAddressInProgress).toBe(true);

    const rejected = reducer(pending, {
      type: updateLaundryAddressThunk.rejected.type,
      payload: { code: 'change-not-allowed' },
    });
    expect(rejected.updateAddressInProgress).toBe(false);
    expect(rejected.updateAddressError).toEqual({ code: 'change-not-allowed' });
    // The profile call's own error is untouched: the two fail for different reasons
    // and the form shows a different message for each.
    expect(rejected.updateProfileError).toBeNull();
  });

  // Mirrors ProfileSettingsPage.duck.js's uploadImageThunk reducer behaviour - the
  // Logo (2026-09-11) reuses the same upload mechanism.
  it('tracks an in-flight Logo upload, then clears it once the profile is saved', () => {
    const pending = reducer(initial, uploadImageThunk.pending('req', { id: 'tmp-1', file: {} }));
    expect(pending.uploadInProgress).toBe(true);
    expect(pending.image).toEqual({ id: 'tmp-1', file: {} });

    const fulfilled = reducer(pending, {
      type: uploadImageThunk.fulfilled.type,
      payload: { id: 'tmp-1', uploadedImage: { id: { uuid: 'img-1' } } },
    });
    expect(fulfilled.uploadInProgress).toBe(false);
    expect(fulfilled.image).toEqual({
      id: 'tmp-1',
      imageId: { uuid: 'img-1' },
      file: {},
      uploadedImage: { id: { uuid: 'img-1' } },
    });

    // The in-flight image is cleared once the profile write that actually attaches
    // it has succeeded - otherwise a second, unrelated save would silently re-attach
    // a stale upload.
    const saved = reducer(fulfilled, { type: updateProfileThunk.fulfilled.type });
    expect(saved.image).toBeNull();
  });

  it('clears the image and records the error when the upload fails', () => {
    const pending = reducer(initial, uploadImageThunk.pending('req', { id: 'tmp-1', file: {} }));

    const rejected = reducer(pending, {
      type: uploadImageThunk.rejected.type,
      payload: { id: 'tmp-1', error: { type: 'error', status: 500 } },
    });

    expect(rejected.image).toBeNull();
    expect(rejected.uploadInProgress).toBe(false);
    expect(rejected.uploadImageError).toEqual({ type: 'error', status: 500 });
  });
});
