import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { Heading } from '../../../components';

import { getListingPickupLocation } from '../../../util/listingLocation';

import AddressLinkMaybe from './AddressLinkMaybe';

import css from './TransactionPanel.module.css';

// Functional component as a helper to build ActivityFeed section
const BookingLocationMaybe = props => {
  const { className, rootClassName, listing, showBookingLocation } = props;
  const classes = classNames(rootClassName || css.bookingLocationContainer, className);

  if (showBookingLocation) {
    // Pickup/return happens at the assigned laundry, not the owner's home
    // address (see util/listingLocation.js).
    const location = getListingPickupLocation(listing);
    return (
      <div className={classes}>
        <Heading as="h3" rootClassName={css.sectionHeading}>
          <FormattedMessage id="TransactionPanel.bookingLocationHeading" />
        </Heading>
        <div className={css.bookingLocationContent}>
          <AddressLinkMaybe
            linkRootClassName={css.bookingLocationAddress}
            location={location}
            geolocation={listing?.attributes?.geolocation}
            showAddress={true}
          />
        </div>
      </div>
    );
  }
  return null;
};

export default BookingLocationMaybe;
