import React, { Component } from 'react';
import { FormattedMessage } from '../../util/reactIntl';
import classNames from 'classnames';
import { propTypes } from '../../util/types';
import { BUSINESS_DAYS, formatTime12Hour } from '../../util/businessHours';
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
 * @param {number} [props.cleaningTurnaroundDays] - Cocloset: the assigned studio's live
 *   turnaround, resolved by ListingPage.duck.js. Omitted from the card when not known.
 * @param {Object} [props.businessHoursByDay] - Cocloset: the assigned studio's opening hours,
 *   `{ mon: { open, close }, ... }` with open days only, from its public profile. Omitted
 *   from the card when not known.
 * @returns {JSX.Element} section map maybe component
 */
class SectionMapMaybe extends Component {
  constructor(props) {
    super(props);
    this.state = { isStatic: true };
  }

  render() {
    const {
      className,
      rootClassName,
      geolocation,
      publicData,
      listingId,
      mapsConfig,
      cleaningTurnaroundDays,
      businessHoursByDay,
    } = this.props;

    // The studio name + street address, or null when no laundry has been assigned.
    const laundryLocation = getAssignedLaundryLocation(publicData);

    // The studio's open days, in the marketplace's week order. Same derivation as
    // ProfilePage's, which renders the studio's own copy of this list - a garment's page and
    // its studio's page disagreeing about opening hours would be its own small bug.
    const businessHoursEntries = BUSINESS_DAYS.filter(day => businessHoursByDay?.[day]).map(
      day => ({ day, ...businessHoursByDay[day] })
    );

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
            {laundryLocation.neighborhood ? (
              <p className={css.pickupLocationNeighborhood}>{laundryLocation.neighborhood}</p>
            ) : null}
            {/* How long this studio takes between rentals. Resolved live by the same page-load
                call that produces the calendar's blocked days, so the number here and the days
                the calendar refuses cannot disagree. Omitted entirely when it is not known -
                a turnaround printed as a guess is a promise nobody made. */}
            {cleaningTurnaroundDays > 0 ? (
              <p className={css.pickupLocationMeta}>
                <FormattedMessage
                  id="ListingPage.pickupLocationTurnaround"
                  values={{ days: cleaningTurnaroundDays }}
                />
              </p>
            ) : null}
            {/* WHEN THE COUNTER IS ACTUALLY OPEN.
                  > "se puede reservar aunque laundry haya cerrado, solo aseguremonos que se
                  >  muestren los horarios de la laundry en la listing page, o en el checkout
                  >  o en transaction page" (Jonathan, 2026-09-28)

                A rental can now start the day it is booked, at any hour - a closed studio is
                deliberately NOT a reason to refuse the booking. That makes these hours the
                one thing a customer booking a same-day collection at 23:50 cannot work out
                and has to know. Hours are a property of the STUDIO, so they are read from its
                public profile at page load rather than copied onto the garment (see
                fetchAssignedLaundryHoursThunk); absent until that answers, and on any
                failure, in which case this block simply is not there. */}
            {businessHoursEntries.length > 0 ? (
              <div className={css.pickupLocationHours}>
                <span className={css.pickupLocationHoursLabel}>
                  <FormattedMessage id="ListingPage.pickupLocationHoursLabel" />
                </span>
                {/* One row per OPEN day. A closed day carries no hours and is simply absent
                    from the record, so this list is the studio's open days by construction -
                    see util/businessHours.js on why there is no `closed: true`. */}
                <ul className={css.pickupLocationHoursList}>
                  {businessHoursEntries.map(({ day, open, close }) => (
                    <li key={day} className={css.pickupLocationHoursRow}>
                      <span className={css.pickupLocationHoursDay}>
                        <FormattedMessage id={`ProfilePage.day.${day}`} />
                      </span>
                      <span>
                        {formatTime12Hour(open)} – {formatTime12Hour(close)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
