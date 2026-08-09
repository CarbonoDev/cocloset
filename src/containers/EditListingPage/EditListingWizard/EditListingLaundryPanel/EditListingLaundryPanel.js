import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import { checkListingLaundryAssignment, fetchLaundries } from '../../../../util/api';
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
 * THE PICKER LOCKS WHILE THE GARMENT IS AT THE LAUNDRY
 *   > "No se debe cambiar la laundry seleccionada por el provider para un listing
 *   >  a menos que ya se haya devuelto la prenda onLaundry = false"
 *
 * `listing.metadata.onLaundry` is written only by the server (it is metadata, so
 * an owner cannot forge it - see server/api-util/listingCustody.js), which is what
 * makes it safe to read here. When it is true the cards stop being selectable and
 * a notice says why; re-saving the SAME laundry is still allowed so the wizard tab
 * never dead-ends.
 *
 * The lock in this file is a courtesy, not the enforcement. Submitting first asks
 * /api/listing-laundry-assignment, which re-reads `onLaundry` server-side, so a
 * page that was loaded while the garment was home and submitted after it came back
 * is refused. Read the header of server/api/listing-laundry-assignment.js for what
 * that does and does NOT stop - the wizard's write goes browser -> Marketplace API
 * and our server is not in that path.
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
  // 409 from /api/listing-laundry-assignment: the garment went back to the
  // laundry after this page was rendered, so the picker should have been locked.
  const [lockError, setLockError] = useState(false);
  // Any other failure of that same check. Kept distinct from lockError on
  // purpose: telling an owner "the garment is at the laundry" because their wifi
  // dropped would be a lie about their own garment.
  const [checkError, setCheckError] = useState(false);

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
  // Physical custody. Server-written metadata; see the docblock above.
  const isOnLaundry = listing?.attributes?.metadata?.onLaundry === true;
  // Console stores categories as categoryLevel1/2/3, never a single `category` key — reading
  // `publicData.category` meant this was always undefined and the accepted-category check
  // below could never fire. A listing may be categorised at several levels, so compare against
  // all of them.
  const listingCategories = getListingCategoryValues(listing?.attributes?.publicData);
  // The array identity changes on every render, so the effect below keys off the joined
  // string instead — otherwise passing it as a dependency would refetch the whole
  // directory on each keystroke elsewhere in the wizard.
  const listingCategoriesKey = listingCategories.join(',');

  useEffect(() => {
    let isMounted = true;
    setFetchLaundriesInProgress(true);
    // Send the garment's category chain so each card can show the turnaround this
    // laundry set for THIS kind of garment ("por categoría grande") rather than a
    // studio-wide number that may be wrong for what is actually being cleaned.
    fetchLaundries(listingCategoriesKey ? listingCategoriesKey.split(',') : [])
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
  }, [listingCategoriesKey]);

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

      {lockError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingLaundryPanel.laundryLockedError" />
        </p>
      ) : null}

      {checkError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingLaundryPanel.assignmentCheckFailed" />
        </p>
      ) : null}

      <EditListingLaundryForm
        className={css.form}
        initialValues={getInitialValues(props)}
        laundries={laundries}
        fetchLaundriesInProgress={fetchLaundriesInProgress}
        listingCategories={listingCategories}
        laundryLocked={isOnLaundry}
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
          setLockError(false);
          setCheckError(false);

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

          // No listing yet means the create flow's very first tab, which this is
          // not (LAUNDRY always follows DETAILS). Guard anyway rather than POST
          // an undefined id - and a listing that does not exist cannot have a
          // garment sitting in a studio, so there is nothing to check.
          const listingId = listing?.id?.uuid;
          if (!listingId) {
            return onSubmit(updateValues);
          }

          // Re-read `onLaundry` server-side before writing. This is what catches
          // the stale page the client-side lock cannot: rendered while the
          // garment was home, submitted after it came back.
          return checkListingLaundryAssignment({
            listingId,
            assignedLaundryId: selectedLaundry.id,
          })
            .then(() => onSubmit(updateValues))
            .catch(e => {
              if (e?.status === 409) {
                setLockError(true);
              } else {
                setCheckError(true);
              }
            });
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
