jest.mock('./integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

const { getIntegrationSdk } = require('./integrationSdk');
const { resolveLiveInitialCleaningDays } = require('./liveInitialCleaning');

const LAUNDRY_ID = 'laundry-1';

const listingWith = ({ metadata = {}, publicData = {} } = {}) => ({
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: {
    metadata: { assignedLaundryId: LAUNDRY_ID, ...metadata },
    publicData,
  },
});

const sdkReturning = privateData => {
  const show = jest.fn(() =>
    Promise.resolve({ data: { data: { attributes: { profile: { privateData } } } } })
  );
  return { show, sdk: { users: { show } } };
};

const sdkRejecting = error => {
  const show = jest.fn(() => Promise.reject(error || new Error('boom')));
  return { show, sdk: { users: { show } } };
};

describe('resolveLiveInitialCleaningDays', () => {
  describe('when it must not call the Integration API at all', () => {
    // The load-bearing case. A previous change deliberately took the Integration API
    // OFF the checkout path; the gate calls this on every booking, so a call here for a
    // garment already at its laundry would put an admin-credentialled round trip between
    // every returning customer and their payment.
    it('answers null for a garment already at its laundry, without asking', async () => {
      const { sdk, show } = sdkReturning({ turnaroundDays: 9 });
      const result = await resolveLiveInitialCleaningDays({
        listing: listingWith({ metadata: { onLaundry: true } }),
        integrationSdk: sdk,
      });
      expect(result).toBeNull();
      expect(show).not.toHaveBeenCalled();
    });

    // `=== true` and not truthiness, matching bookingRules and evaluateLaundryAssignment:
    // `onLaundry: 'true'` is bad data, not custody, and must not switch the rule off.
    it.each([['the string "true"', 'true'], ['1', 1], ['false', false], ['absent', undefined]])(
      'still resolves when onLaundry is %s',
      async (_label, onLaundry) => {
        const { sdk, show } = sdkReturning({ turnaroundDays: 4 });
        const result = await resolveLiveInitialCleaningDays({
          listing: listingWith({ metadata: { onLaundry } }),
          integrationSdk: sdk,
        });
        expect(result).toBe(4);
        expect(show).toHaveBeenCalledTimes(1);
      }
    );

    it('answers null when no laundry is assigned', async () => {
      const { sdk, show } = sdkReturning({ turnaroundDays: 9 });
      const result = await resolveLiveInitialCleaningDays({
        listing: {
          id: { uuid: 'listing-1' },
          attributes: { metadata: {}, publicData: {} },
        },
        integrationSdk: sdk,
      });
      expect(result).toBeNull();
      expect(show).not.toHaveBeenCalled();
    });
  });

  describe('the resolution chain', () => {
    it('reads the studio-wide turnaround out of the laundry privateData', async () => {
      const { sdk, show } = sdkReturning({ turnaroundDays: 2 });
      const result = await resolveLiveInitialCleaningDays({
        listing: listingWith(),
        integrationSdk: sdk,
      });
      expect(result).toBe(2);
      expect(show).toHaveBeenCalledWith({ id: LAUNDRY_ID });
    });

    // This is the point of the feature: the number must come from the laundry's CURRENT
    // configuration, not from the snapshot. So a stored snapshot that disagrees is
    // ignored here entirely - the precedence between the two lives in bookingRules.
    it('ignores the stored snapshot completely', async () => {
      const { sdk } = sdkReturning({ turnaroundDays: 6 });
      const result = await resolveLiveInitialCleaningDays({
        listing: listingWith({ metadata: { initialCleaningDays: 2 } }),
        integrationSdk: sdk,
      });
      expect(result).toBe(6);
    });

    // Same chain the snapshot was written with (laundryAssignment.resolveInitialCleaningDays):
    // the garment's top-level category first, studio-wide second. Resolving these two
    // differently is what would make the live value and the snapshot disagree for a
    // laundry that has changed nothing.
    it('prefers a per-category turnaround for this garment', async () => {
      const { sdk } = sdkReturning({
        turnaroundDays: 2,
        categoryPricing: { dresses: { turnaroundDays: 5 } },
      });
      const result = await resolveLiveInitialCleaningDays({
        listing: listingWith({ publicData: { categoryLevel1: 'dresses', categoryLevel2: 'midi' } }),
        integrationSdk: sdk,
      });
      expect(result).toBe(5);
    });

    it('falls back to the studio-wide value for an unconfigured category', async () => {
      const { sdk } = sdkReturning({
        turnaroundDays: 2,
        categoryPricing: { suits: { turnaroundDays: 5 } },
      });
      const result = await resolveLiveInitialCleaningDays({
        listing: listingWith({ publicData: { categoryLevel1: 'dresses' } }),
        integrationSdk: sdk,
      });
      expect(result).toBe(2);
    });

    it('rounds a fractional turnaround up, never down', async () => {
      const { sdk } = sdkReturning({});
      const result = await resolveLiveInitialCleaningDays({
        listing: listingWith(),
        integrationSdk: sdk,
        envDefaultBufferDays: '1.2',
      });
      // Under-blocking means offering a garment that is still in the wash.
      expect(result).toBe(2);
    });

    it('applies the env default when the studio has configured nothing', async () => {
      const { sdk } = sdkReturning({});
      const result = await resolveLiveInitialCleaningDays({
        listing: listingWith(),
        integrationSdk: sdk,
        envDefaultBufferDays: '4',
      });
      expect(result).toBe(4);
    });
  });

  describe('failure never opens the gate', () => {
    // Every one of these returns null, and null means "use the snapshot" to the caller -
    // see bookingRules.resolveInitialCleaningBlockDays. It must NEVER mean "no block".
    it('answers null when the laundry user cannot be fetched', async () => {
      const { sdk } = sdkRejecting(Object.assign(new Error('gone'), { status: 404 }));
      await expect(
        resolveLiveInitialCleaningDays({ listing: listingWith(), integrationSdk: sdk })
      ).resolves.toBeNull();
    });

    it('answers null on an Integration API outage rather than rejecting', async () => {
      const { sdk } = sdkRejecting(Object.assign(new Error('boom'), { status: 500 }));
      await expect(
        resolveLiveInitialCleaningDays({ listing: listingWith(), integrationSdk: sdk })
      ).resolves.toBeNull();
    });

    // The subtle one. `resolveInitialCleaningDays` bottoms out in a hardcoded 2-day
    // default, so handing it an unreadable profile would INVENT a two-day lead time out
    // of a failed read - a number no laundry ever configured, applied to a real listing.
    it.each([['missing', undefined], ['null', null], ['not an object', 'nope']])(
      'answers null when the laundry profile privateData is %s',
      async (_label, privateData) => {
        const { sdk } = sdkReturning(privateData);
        await expect(
          resolveLiveInitialCleaningDays({ listing: listingWith(), integrationSdk: sdk })
        ).resolves.toBeNull();
      }
    );

    it('answers null for a missing listing rather than throwing', async () => {
      await expect(resolveLiveInitialCleaningDays({ listing: undefined })).resolves.toBeNull();
      expect(getIntegrationSdk).not.toHaveBeenCalled();
    });

    // A SYNCHRONOUS failure - no Integration API credentials configured, so
    // getIntegrationSdk throws or hands back nothing usable. This has to arrive as a
    // resolved null like every other failure: the checkout path calls this inside a
    // promise chain and is prepared for a rejection, not for a thrown exception, so
    // letting it escape would turn a stale-but-safe fallback into a 500 on a real sale.
    it('answers null when the Integration API client cannot even be built', async () => {
      getIntegrationSdk.mockImplementation(() => {
        throw new Error('SHARETRIBE_INTEGRATION_CLIENT_ID missing');
      });
      await expect(resolveLiveInitialCleaningDays({ listing: listingWith() })).resolves.toBeNull();
    });

    it('answers null when the injected sdk has no users resource', async () => {
      await expect(
        resolveLiveInitialCleaningDays({ listing: listingWith(), integrationSdk: {} })
      ).resolves.toBeNull();
    });
  });

  it('reaches for the real Integration API when no sdk is injected', async () => {
    const { sdk } = sdkReturning({ turnaroundDays: 3 });
    getIntegrationSdk.mockReturnValue(sdk);
    await expect(resolveLiveInitialCleaningDays({ listing: listingWith() })).resolves.toBe(3);
    expect(getIntegrationSdk).toHaveBeenCalled();
  });
});
