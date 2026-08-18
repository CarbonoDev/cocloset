import { loadData } from './InboxPage.duck';

// WHAT THIS FILE IS FOR.
//
// The inbox query shipped broken twice in a row, and neither break was visible in a component
// test, because both were about what the QUERY ASKS FOR rather than about what the page does
// with the answer:
//
//   1. `fields.transaction` / `fields.listing` are ALLOWLISTS. A field that is not named
//      arrives `undefined` - no error, no warning, just a blank row in the detail panel.
//   2. `fields.image` says which variants to RETURN. `imageVariant.<name>` is what makes the
//      API GENERATE one. Naming a variant nobody asked to have generated returns an image with
//      no such variant, and ResponsiveImage renders a broken <img> on every row.
//
// So these assert the request, not the response. They are deliberately literal: the point is
// that removing a line from the query fails a test with the field's name in it.

const runLoadData = () => {
  const query = jest.fn(() => Promise.resolve({ data: { data: [], meta: {} } }));
  const sdk = { transactions: { query } };
  const dispatch = jest.fn(action =>
    typeof action === 'function' ? action(dispatch, () => ({}), sdk) : action
  );

  return Promise.resolve(loadData({ tab: 'orders' }, '')(dispatch, () => ({}), sdk)).then(() => {
    if (!query.mock.calls.length) {
      throw new Error('loadData never queried transactions');
    }
    return query.mock.calls[0][0];
  });
};

describe('InboxPage loadData query', () => {
  it('asks the API to GENERATE the garment thumbnail, not just to return it', async () => {
    // The bug: `variants.listing-card` was named in `fields.image` but never requested with
    // `imageVariant.listing-card`, so every row rendered a broken image.
    const params = await runLoadData();
    expect(params['imageVariant.listing-card']).toBeDefined();
    expect(params['imageVariant.listing-card-2x']).toBeDefined();
  });

  it('returns the variants it generates', async () => {
    // The other half of the same pairing: generating a variant nobody named comes back unused.
    const params = await runLoadData();
    expect(params['fields.image']).toEqual(expect.arrayContaining(['variants.listing-card']));
    expect(params['fields.image']).toEqual(expect.arrayContaining(['variants.listing-card-2x']));
  });

  it('includes the listing images', async () => {
    const params = await runLoadData();
    expect(params.include).toEqual(expect.arrayContaining(['listing.images']));
  });

  it('asks for the fields the detail panel renders', async () => {
    // Each of these is a line the panel prints. Dropping one blanks that line silently.
    const params = await runLoadData();
    expect(params['fields.transaction']).toEqual(expect.arrayContaining(['metadata']));
    expect(params['fields.listing']).toEqual(
      expect.arrayContaining([
        'publicData.brand',
        'publicData.assignedLaundryName',
        'publicData.pickupAddress',
        // Not shown, but the panel formats its dates in the listing's zone rather than the
        // reader's - without this the detail would name a different day than the row does.
        'availabilityPlan',
      ])
    );
  });
});
