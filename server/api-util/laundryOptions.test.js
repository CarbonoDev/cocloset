const { buildLaundryOptions } = require('./laundryDirectory');

// The PUBLIC name/id list behind the search page's pickup filter.
//
//   > "Manten el filtro / Arma un endpoint publico para mostrar laundries"
//
// The shape is the security contract here, so that is what these assert: exactly two keys,
// and nothing from the rich directory record - which carries a studio's address, coordinates,
// business hours and a turnaround resolved from its privateData, and requires a session for
// exactly that reason (see server/api/laundries.js).

const laundryUser = (id, studioName, extra = {}, neighborhood = undefined) => ({
  id: { uuid: id },
  attributes: {
    profile: {
      displayName: `${studioName} owner`,
      metadata: { isLaundry: true },
      publicData: {
        ...(neighborhood ? { neighborhood } : {}),
        laundryProfile: {
          studioName,
          address: '47 Rue Vieille du Temple',
          origin: { lat: 48.86, lng: 2.36 },
          businessHours: 'Tue-Sun 10:00-20:00',
          ...extra,
        },
      },
      privateData: { turnaroundDays: 2, categoryPricing: { dresses: { cleaningFee: 900 } } },
    },
  },
});

const plainUser = id => ({
  id: { uuid: id },
  attributes: { profile: { displayName: 'A customer', metadata: {}, publicData: {} } },
});

describe('buildLaundryOptions', () => {
  it('returns exactly an id, a name and a neighbourhood, and nothing else', () => {
    // THE WHOLE POINT. Adding a key here is adding it to a public surface, so it has to be a
    // decision rather than a spread - and this test is what makes it one.
    //
    // `neighborhood` was added on 2026-09-03 for the search filter's label. It is a district
    // name the studio typed about itself, at the granularity a shopper picks a pickup point
    // by - not the street address the test below still guards.
    const [option] = buildLaundryOptions([laundryUser('l1', 'Maison du Marais')]);
    expect(Object.keys(option).sort()).toEqual(['id', 'name', 'neighborhood']);
    expect(option).toEqual({ id: 'l1', name: 'Maison du Marais', neighborhood: null });
  });

  //   > "filtremos por laundry pero usando el nombre del vecindario que tenga en su
  //   >  dirección, solo es cambiar el label en las opciones de búsqueda"
  it('carries the neighbourhood when the studio has given one', () => {
    const [option] = buildLaundryOptions([laundryUser('l1', 'Maison du Marais', {}, 'Le Marais')]);
    expect(option.neighborhood).toBe('Le Marais');
    // The name still goes too: it is the fallback label, and it is what every listing card
    // and every email prints.
    expect(option.name).toBe('Maison du Marais');
  });

  it('sends null rather than dropping the key when there is no neighbourhood', () => {
    // A missing key and an absent value would be indistinguishable to the client, which has
    // to choose a fallback label from exactly this.
    const [option] = buildLaundryOptions([laundryUser('l1', 'Maison du Marais')]);
    expect(option.neighborhood).toBeNull();
  });

  it('leaks no address, coordinates, hours or turnaround', () => {
    const serialised = JSON.stringify(buildLaundryOptions([laundryUser('l1', 'Maison du Marais')]));
    ['Rue Vieille', '48.86', 'Tue-Sun', 'turnaround', 'cleaningFee'].forEach(fragment => {
      expect(serialised).not.toContain(fragment);
    });
  });

  it('keeps only users flagged as laundries', () => {
    // `metadata.isLaundry === true`, not truthiness: the flag is Integration-API-only and a
    // bad value must not put a customer in a public directory.
    const options = buildLaundryOptions([
      laundryUser('l1', 'Maison du Marais'),
      plainUser('u1'),
      { id: { uuid: 'u2' }, attributes: { profile: { metadata: { isLaundry: 'true' } } } },
    ]);
    expect(options.map(o => o.id)).toEqual(['l1']);
  });

  it('includes a studio whose profile is incomplete', () => {
    // DELIBERATELY UNLIKE the wizard's directory, which drops a studio with no usable address
    // because assigning one leaves a listing unpublishable. A filter answers a different
    // question: a studio holding garments belongs in the dropdown regardless, or the customer
    // gets results they cannot reach through the filter.
    const noAddress = laundryUser('l2', 'Studio Pigalle');
    delete noAddress.attributes.profile.publicData.laundryProfile.address;
    delete noAddress.attributes.profile.publicData.laundryProfile.origin;

    expect(buildLaundryOptions([noAddress]).map(o => o.name)).toEqual(['Studio Pigalle']);
  });

  it('drops a studio with no name', () => {
    // An option a reader cannot identify is noise, and the id alone is a UUID.
    const unnamed = laundryUser('l3', 'x');
    delete unnamed.attributes.profile.publicData.laundryProfile.studioName;
    expect(buildLaundryOptions([unnamed])).toEqual([]);
  });

  it('sorts by name, so the dropdown has a stable order', () => {
    const options = buildLaundryOptions([
      laundryUser('l1', 'The Laundry'),
      laundryUser('l2', 'Aurora Atelier Care'),
      laundryUser('l3', 'Maison du Marais'),
    ]);
    expect(options.map(o => o.name)).toEqual([
      'Aurora Atelier Care',
      'Maison du Marais',
      'The Laundry',
    ]);
  });

  it('is an empty list, not a crash, for junk input', () => {
    [[], null, undefined, [null, {}, { attributes: {} }]].forEach(input => {
      expect(buildLaundryOptions(input)).toEqual([]);
    });
  });
});
