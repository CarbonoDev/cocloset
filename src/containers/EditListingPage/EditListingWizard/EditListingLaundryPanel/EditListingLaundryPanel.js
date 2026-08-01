import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import { fetchLaundries } from '../../../../util/api';

// Import shared components
import { H3, ListingLink } from '../../../../components';

// Import modules from this directory
import EditListingLaundryForm from './EditListingLaundryForm';
import css from './EditListingLaundryPanel.module.css';

const getInitialValues = props => {
  const { listing } = props;
  const { publicData } = listing?.attributes || {};
  return { assignedLaundryId: publicData?.assignedLaundryId };
};

/**
 * The EditListingLaundryPanel component.
 *
 * Lets the garment owner pick which laundry (a user flagged isLaundry, see
 * LaundryProfilePage) will hold, hand over, and clean this garment. On
 * submit, the chosen laundry's own address/origin are copied onto the
 * listing's own `geolocation` (top-level attribute) and
 * `publicData.pickupAddress`, so search/map/listing pages show and search by
 * the laundry's location rather than the owner's own address (that address is
 * captured separately, privately, in EditListingLocationPanel).
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {propTypes.ownListing} props.listing - The listing object
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {Function} props.onSubmit - The submit function
 * @param {string} props.submitButtonText - The submit button text
 * @param {boolean} props.panelUpdated - Whether the panel is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Object} props.errors - The errors object
 * @returns {JSX.Element}
 */
const EditListingLaundryPanel = props => {
  const [laundries, setLaundries] = useState([]);
  const [fetchLaundriesInProgress, setFetchLaundriesInProgress] = useState(true);
  const [fetchLaundriesError, setFetchLaundriesError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setFetchLaundriesInProgress(true);
    fetchLaundries()
      .then(response => {
        if (isMounted) {
          setLaundries(response?.data || []);
          setFetchLaundriesInProgress(false);
        }
      })
      .catch(e => {
        if (isMounted) {
          setFetchLaundriesError(e);
          setFetchLaundriesInProgress(false);
        }
      });
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    className,
    rootClassName,
    listing,
    disabled,
    ready,
    onSubmit,
    submitButtonText,
    panelUpdated,
    updateInProgress,
    errors,
    updatePageTitle: UpdatePageTitle,
    intl,
  } = props;

  const classes = classNames(rootClassName || css.root, className);
  const isPublished = listing?.id && listing?.attributes.state !== LISTING_STATE_DRAFT;
  const listingCategory = listing?.attributes?.publicData?.category;

  const panelHeadingProps = isPublished
    ? {
        id: 'EditListingLaundryPanel.title',
        values: { listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> },
        messageProps: { listingTitle: listing.attributes.title },
      }
    : {
        id: 'EditListingLaundryPanel.createListingTitle',
        values: { lineBreak: <br /> },
        messageProps: {},
      };

  return (
    <main className={classes}>
      <UpdatePageTitle
        panelHeading={intl.formatMessage(
          { id: panelHeadingProps.id },
          { ...panelHeadingProps.messageProps }
        )}
      />
      <H3 as="h1">
        <FormattedMessage id={panelHeadingProps.id} values={{ ...panelHeadingProps.values }} />
      </H3>
      <p className={css.description}>
        <FormattedMessage id="EditListingLaundryPanel.description" />
      </p>

      {fetchLaundriesError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingLaundryPanel.fetchLaundriesFailed" />
        </p>
      ) : null}

      <EditListingLaundryForm
        className={css.form}
        initialValues={getInitialValues(props)}
        laundries={laundries}
        fetchLaundriesInProgress={fetchLaundriesInProgress}
        listingCategory={listingCategory}
        onSubmit={values => {
          const { assignedLaundryId } = values;
          const selectedLaundry = laundries.find(l => l.id === assignedLaundryId);
          const { laundryProfile = {} } = selectedLaundry?.publicData || {};
          const { address, origin } = laundryProfile;

          // New values for listing attributes. The listing's own geolocation
          // and pickup address now come from the assigned laundry, not the
          // owner (see the module docblock above / EditListingLocationPanel).
          const updateValues = {
            geolocation: origin,
            publicData: {
              assignedLaundryId: selectedLaundry.id,
              assignedLaundryName: selectedLaundry.displayName,
              pickupAddress: address,
            },
          };
          onSubmit(updateValues);
        }}
        saveActionMsg={submitButtonText}
        disabled={disabled}
        ready={ready}
        updated={panelUpdated}
        updateInProgress={updateInProgress}
        fetchErrors={errors}
      />
    </main>
  );
};

export default EditListingLaundryPanel;
