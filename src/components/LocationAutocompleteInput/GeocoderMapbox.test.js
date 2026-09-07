import { placeNeighborhood } from './GeocoderMapbox';

//   > "las laundries tienen el input de autocomplete, de ahi hay que obtener el vecindario,
//   >  si no es posible obtenerlo se utilizará un field de vecindario" (Jonathan, 2026-09-07)
//
// The fallback field only earns its place if this genuinely cannot answer, so what these pin
// is both halves: the shapes it reads, and the ones it declines rather than guessing at.
// Fixtures are Mapbox forward-geocode features, trimmed to the fields this reads.

const feature = (context, extra = {}) => ({
  place_type: ['address'],
  text: '47 Rue Vieille du Temple',
  context,
  ...extra,
});

describe('placeNeighborhood', () => {
  it('reads the neighborhood out of the context hierarchy', () => {
    expect(
      placeNeighborhood(
        feature([
          { id: 'neighborhood.123', text: 'Le Marais' },
          { id: 'postcode.456', text: '75004' },
          { id: 'place.789', text: 'Paris' },
        ])
      )
    ).toBe('Le Marais');
  });

  it('falls back to the locality where Mapbox carries no neighbourhood', () => {
    // Its answer for places whose districts it does not have. A village name is a better
    // answer than none.
    expect(
      placeNeighborhood(
        feature([{ id: 'locality.1', text: 'Sant Antoni' }, { id: 'place.2', text: 'Barcelona' }])
      )
    ).toBe('Sant Antoni');
  });

  it('prefers the neighbourhood when both are present', () => {
    expect(
      placeNeighborhood(
        feature([
          { id: 'locality.1', text: 'Eixample' },
          { id: 'neighborhood.2', text: 'Sant Antoni' },
        ])
      )
    ).toBe('Sant Antoni');
  });

  it('never answers with the city', () => {
    // "Barcelona" as the label of a pickup filter in a Barcelona marketplace tells the reader
    // nothing, which is the whole reason the filter was relabelled.
    expect(placeNeighborhood(feature([{ id: 'place.1', text: 'Barcelona' }]))).toBeNull();
    expect(placeNeighborhood(feature([{ id: 'region.1', text: 'Catalunya' }]))).toBeNull();
    expect(placeNeighborhood(feature([{ id: 'country.1', text: 'Spain' }]))).toBeNull();
  });

  it('uses the feature itself when the studio searched for a neighbourhood', () => {
    // Searching "Le Marais" rather than a street address: the answer is the feature's own
    // text, and there is no context entry for it.
    expect(
      placeNeighborhood({ place_type: ['neighborhood'], text: 'Le Marais', context: [] })
    ).toBe('Le Marais');
  });

  it('declines rather than guessing, so the manual field can take over', () => {
    expect(placeNeighborhood(feature([]))).toBeNull();
    expect(placeNeighborhood(feature(undefined))).toBeNull();
    expect(placeNeighborhood(undefined)).toBeNull();
    expect(placeNeighborhood({})).toBeNull();
    // A malformed entry is not an answer either.
    expect(placeNeighborhood(feature([{ text: 'Le Marais' }]))).toBeNull();
  });
});
