import { types as sdkTypes } from '../../util/sdkLoader';
import { userLocation } from '../../util/maps';

const { LatLng: SDKLatLng, LatLngBounds: SDKLatLngBounds } = sdkTypes;

export const CURRENT_LOCATION_ID = 'current-location';

const GENERATED_BOUNDS_DEFAULT_DISTANCE = 500; // meters
// Distances for generated bounding boxes for different Mapbox place types
const PLACE_TYPE_BOUNDS_DISTANCES = {
  address: 500,
  country: 2000,
  region: 2000,
  postcode: 2000,
  district: 2000,
  place: 2000,
  locality: 2000,
  neighborhood: 2000,
  poi: 2000,
  'poi.landmark': 2000,
};

const locationBounds = (latlng, distance) => {
  if (!latlng) {
    return null;
  }

  const bounds = new window.mapboxgl.LngLat(latlng.lng, latlng.lat).toBounds(distance);
  return new SDKLatLngBounds(
    new SDKLatLng(bounds.getNorth(), bounds.getEast()),
    new SDKLatLng(bounds.getSouth(), bounds.getWest())
  );
};

const placeOrigin = prediction => {
  if (prediction && Array.isArray(prediction.center) && prediction.center.length === 2) {
    // Coordinates in Mapbox features are represented as [longitude, latitude].
    return new SDKLatLng(prediction.center[1], prediction.center[0]);
  }
  return null;
};

// THE NEIGHBOURHOOD, OUT OF THE FEATURE WE ALREADY ASKED FOR.
//
//   > "las laundries tienen el input de autocomplete, de ahi hay que obtener el vecindario"
//   >  (Jonathan, 2026-09-07)
//
// Mapbox returns the administrative hierarchy an address sits in as `context` - each entry
// an `id` like `neighborhood.12345` and a human `text`. The template threw the whole array
// away, keeping only the formatted address string, which is why nothing in this app could
// answer "which part of town is this studio in".
//
// `neighborhood` first, then `locality`: the second is Mapbox's answer for places whose
// districts it does not carry, and a village name is a better answer than none. `place` is
// deliberately NOT in the chain - that is the city, and labelling a pickup filter "Barcelona"
// in a Barcelona marketplace tells the reader nothing.
const CONTEXT_TYPES_IN_PREFERENCE_ORDER = ['neighborhood', 'locality'];

const placeNeighborhood = prediction => {
  const context = Array.isArray(prediction?.context) ? prediction.context : [];

  const match = CONTEXT_TYPES_IN_PREFERENCE_ORDER.reduce(
    (found, type) =>
      found ||
      context.find(entry => typeof entry?.id === 'string' && entry.id.startsWith(`${type}.`)),
    null
  );

  // The feature itself can BE a neighbourhood, when somebody searches for one rather than for
  // a street address. Its own text is then the answer and there is no context entry for it.
  const isOwnType =
    Array.isArray(prediction?.place_type) &&
    CONTEXT_TYPES_IN_PREFERENCE_ORDER.includes(prediction.place_type[0]);

  return match?.text || (isOwnType ? prediction?.text : null) || null;
};

const placeBounds = prediction => {
  if (prediction) {
    if (Array.isArray(prediction.bbox) && prediction.bbox.length === 4) {
      // Bounds in Mapbox features are represented as [minX, minY, maxX, maxY]
      return new SDKLatLngBounds(
        new SDKLatLng(prediction.bbox[3], prediction.bbox[2]),
        new SDKLatLng(prediction.bbox[1], prediction.bbox[0])
      );
    } else {
      // If bounds are not available, generate them around the origin

      // Resolve bounds distance based on place type
      const placeType = Array.isArray(prediction.place_type) && prediction.place_type[0];

      const distance =
        (placeType && PLACE_TYPE_BOUNDS_DISTANCES[placeType]) || GENERATED_BOUNDS_DEFAULT_DISTANCE;

      return locationBounds(placeOrigin(prediction), distance);
    }
  }
  return null;
};

export const GeocoderAttribution = () => null;

/**
 * A forward geocoding (place name -> coordinates) implementation
 * using the Mapbox Geocoding API.
 */
class GeocoderMapbox {
  getClient() {
    const libLoaded = typeof window !== 'undefined' && window.mapboxgl && window.mapboxSdk;
    if (!libLoaded) {
      throw new Error('Mapbox libraries are required for GeocoderMapbox');
    }
    if (!this._client && window?.mapboxgl?.accessToken) {
      this._client = window.mapboxSdk({
        accessToken: window.mapboxgl.accessToken,
      });
    }
    return this._client;
  }

  // Public API
  //

  /**
   * Search places with the given name.
   *
   * @param {String} search query for place names
   *
   * @return {Promise<{ search: String, predictions: Array<Object>}>}
   * results of the geocoding, should have the original search query
   * and an array of predictions. The format of the predictions is
   * only relevant for the `getPlaceDetails` function below.
   */
  getPlacePredictions(search, countryLimit, locale) {
    const limitCountriesMaybe = countryLimit ? { countries: countryLimit } : {};

    return this.getClient()
      .geocoding.forwardGeocode({
        query: search,
        limit: 5,
        ...limitCountriesMaybe,
        language: [locale],
      })
      .send()
      .then(response => {
        return {
          search,
          predictions: response.body.features,
        };
      });
  }

  /**
   * Get the ID of the given prediction.
   */
  getPredictionId(prediction) {
    return prediction.id;
  }

  /**
   * Get the address text of the given prediction.
   */
  getPredictionAddress(prediction) {
    if (prediction.predictionPlace) {
      // default prediction defined above
      return prediction.predictionPlace.address;
    }
    // prediction from Mapbox geocoding API
    return prediction.place_name;
  }

  /**
   * Fetch or read place details from the selected prediction.
   *
   * @param {Object} prediction selected prediction object
   *
   * @return {Promise<util.propTypes.place>} a place object
   */
  getPlaceDetails(prediction, currentLocationBoundsDistance) {
    if (this.getPredictionId(prediction) === CURRENT_LOCATION_ID) {
      return userLocation().then(latlng => {
        return {
          address: '',
          origin: latlng,
          bounds: locationBounds(latlng, currentLocationBoundsDistance),
        };
      });
    }

    if (prediction.predictionPlace) {
      return Promise.resolve(prediction.predictionPlace);
    }

    return Promise.resolve({
      address: this.getPredictionAddress(prediction),
      origin: placeOrigin(prediction),
      bounds: placeBounds(prediction),
      // Additive: every existing caller reads address/origin/bounds and is unaffected. The
      // laundry settings form is the one that wants this, and it falls back to asking when
      // Mapbox has no answer - see LaundryProfilePage.
      neighborhood: placeNeighborhood(prediction),
    });
  }
}

export { placeNeighborhood };

export default GeocoderMapbox;
