import React, { Component } from 'react';
import { FormattedMessage } from '../../util/reactIntl';
import classNames from 'classnames';
import { propTypes } from '../../util/types';
import { getAssignedLaundryLocation, getPickupLocation } from '../../util/listingLocation';
import { obfuscatedCoordinates } from '../../util/maps';
import { Heading, Map } from '../../components';

import css from './ListingPage.module.css';

/**
 * The SectionMapMaybe component.
 *
 * Renders the pickup location of a garment: the assigned laundry's studio name and
 * street address as readable text, plus the map already centred on that studio.
 *
 *   > "el listing en listingPage debe mostrar la dirección de la laundry […]
 *   >  hay que asignar esta dirección en el mapa, ademas de mostrar el texto de
 *   >  la dirección"
 *
 * The map half was already correct — assignment copies the laundry's coordinates
 * onto the listing's own `geolocation` (see server/api-util/laundryAssignment.js),
 * so the pin has always been the studio. What was missing is that a renter could
 * see a dot on a map and no address to actually travel to.
 *
 * WHY THE TEXT IS GATED ON getAssignedLaundryLocation AND THE MAP LABEL IS NOT.
 * The map's `address` is only a caption on a static-map image and an accessible
 * name; the text block is the address printed as prose on a public page. Those
 * have different blast radii, so they read the location through different
 * helpers. `getPickupLocation` falls back to the legacy `publicData.location`,
 * which on listings created before EditListingLocationPanel was repurposed holds
 * the OWNER'S HOME ADDRESS — printing that here would be a privacy incident, not
 * a graceful fallback. getAssignedLaundryLocation returns null for that case; see
 * util/listingLocation.js.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {propTypes.latlng} [props.geolocation] - The geolocation
 * @param {Object} [props.publicData] - The listing's publicData
 * @param {propTypes.uuid} props.listingId - The listing id
 * @param {Object} props.mapsConfig - config.maps
 * @returns {JSX.Element} section map maybe component
 */
class SectionMapMaybe extends Component {
  constructor(props) {
    super(props);
    this.state = { isStatic: true };
  }

  render() {
    const { className, rootClassName, geolocation, publicData, listingId, mapsConfig } = this.props;

    // The studio name + street address, or null when no laundry has been assigned.
    const laundryLocation = getAssignedLaundryLocation(publicData);

    // Either half alone is worth a section. A missing `geolocation` used to hide
    // the whole block, which would now also swallow an address we do have — and
    // an address a renter can read is more useful than the map it came with.
    if (!geolocation && !laundryLocation) {
      return null;
    }

    // The mapped location is the assigned laundry's, not the owner's home
    // address (see util/listingLocation.js).
    const address = getPickupLocation(publicData).address || '';
    const classes = classNames(rootClassName || css.sectionMap, className);
    const cacheKey = listingId ? `${listingId.uuid}_${geolocation?.lat}_${geolocation?.lng}` : null;

    const mapProps = mapsConfig.fuzzy.enabled
      ? { obfuscatedCenter: obfuscatedCoordinates(geolocation, mapsConfig.fuzzy.offset, cacheKey) }
      : { address, center: geolocation };
    const map = geolocation ? <Map {...mapProps} useStaticMap={this.state.isStatic} /> : null;

    return (
      <section className={classes} id="listing-location">
        <Heading as="h2" rootClassName={css.sectionHeadingWithExtraMargin}>
          <FormattedMessage id="ListingPage.locationTitle" />
        </Heading>
        {laundryLocation ? (
          <div className={css.pickupLocation}>
            {laundryLocation.building ? (
              <span className={css.pickupLocationName}>{laundryLocation.building}</span>
            ) : null}
            {/* <address> rather than a <p>: this is the contact address of the
                place the garment is handed over, which is exactly what the
                element means. */}
            <address className={css.pickupLocationAddress}>{laundryLocation.address}</address>
            <p className={css.pickupLocationNote}>
              <FormattedMessage id="ListingPage.pickupLocationNote" />
            </p>
          </div>
        ) : null}
        {!map ? null : this.state.isStatic ? (
          <button
            className={css.map}
            onClick={() => {
              this.setState({ isStatic: false });
            }}
          >
            {map}
          </button>
        ) : (
          <div className={css.map}>{map}</div>
        )}
      </section>
    );
  }
}

export default SectionMapMaybe;
