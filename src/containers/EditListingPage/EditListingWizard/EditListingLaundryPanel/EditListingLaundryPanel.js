import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import { fetchLaundries } from '../../../../util/api';
import { getListingCategoryValues } from '../../../../util/fieldHelpers';

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
  // Set when the picked laundry turns out to be unusable at submit time (see
  // the guard in onSubmit below). Without it the failure is silent.
  const [selectionError, setSelectionError] = useState(false);

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
  // Console stores categories as categoryLevel1/2/3, never a single `category` key — reading
  // `publicData.category` meant this was always undefined and the accepted-category check
  // below could never fire. A listing may be categorised at several levels, so compare against
  // all of them.
  const listingCategories = getListingCategoryValues(listing?.attributes?.publicData);

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

      {selectionError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingLaundryPanel.laundryUnavailable" />
        </p>
      ) : null}

      <EditListingLaundryForm
        className={css.form}
        initialValues={getInitialValues(props)}
        laundries={laundries}
        fetchLaundriesInProgress={fetchLaundriesInProgress}
        listingCategories={listingCategories}
        onSubmit={values => {
          const { assignedLaundryId } = values;
          const selectedLaundry = laundries.find(l => l.id === assignedLaundryId);

          // The picker's list can go stale between load and submit: the laundry
          // could have been de-flagged, or the fetch could have failed leaving
          // `laundries` empty while initialValues still carries a saved id.
          // Guarding here matters twice over. Without it, `selectedLaundry.id`
          // throws a TypeError on submit (the form's submitDisabled only checks
          // `invalid`, and a stale id IS a valid value). And a laundry with no
          // usable address/origin would write no `geolocation`, which leaves
          // the wizard's LAUNDRY tab permanently incomplete - the owner saves
          // successfully, is redirected forward, is bounced straight back, and
          // is never told why. /api/laundries already filters out
          // profile-less laundries; this is the second line of defence.
          if (!selectedLaundry?.origin || !selectedLaundry?.address) {
            setSelectionError(true);
            return;
          }
          setSelectionError(false);

          // New values for listing attributes. The listing's own geolocation
          // and pickup address now come from the assigned laundry, not the
          // owner (see the module docblock above / EditListingLocationPanel).
          const updateValues = {
            geolocation: selectedLaundry.origin,
            publicData: {
              assignedLaundryId: selectedLaundry.id,
              assignedLaundryName: selectedLaundry.displayName,
              pickupAddress: selectedLaundry.address,
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
