import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import { assignListingLaundry, fetchLaundries } from '../../../../util/api';
import { getListingCategoryValues } from '../../../../util/fieldHelpers';

// Import shared components
import { H3, ListingLink } from '../../../../components';

// Import modules from this directory
import EditListingLaundryForm from './EditListingLaundryForm';
import css from './EditListingLaundryPanel.module.css';

// The saved assignment lives in `metadata`, not `publicData` - the Marketplace API
// refuses an owner's write to metadata, which is the point (see
// server/api-util/laundryAssignment.js). Reading the old `publicData` key here
// would show the picker as empty for every listing that already has a laundry.
const getInitialValues = props => {
  const { listing } = props;
  const { metadata } = listing?.attributes || {};
  return { assignedLaundryId: metadata?.assignedLaundryId };
};

/**
 * The EditListingLaundryPanel component.
 *
 * Lets the garment owner pick which laundry (a user flagged isLaundry, see
 * LaundryProfilePage) will hold, hand over, and clean this garment.
 *
 * THIS PANEL NO LONGER WRITES THE ASSIGNMENT ITSELF
 * It POSTs to /api/listing-laundry-assignment, and the server does the write.
 * `metadata.assignedLaundryId` is Integration-API-only - the Marketplace API
 * refuses an owner's `ownListings.update({ metadata })` with 400
 * `validation-disallowed-key` - so a browser write is not merely discouraged here,
 * it is impossible. That is the whole point of the field having moved: the rule
 *
 *   > "se puede editar la laundry mientras que no este en una transaction activa
 *   >  y que onLaundry sea false"
 *
 * is now applied by the only party that can perform the write, instead of being
 * asked politely of a client that was free to skip the question. Read the header
 * of server/api/listing-laundry-assignment.js before changing anything here.
 *
 * The server also writes the three DERIVED fields in the same call - the chosen
 * laundry's name and address onto `publicData.assignedLaundryName` /
 * `publicData.pickupAddress`, and its origin onto the listing's top-level
 * `geolocation` - so search/map/listing pages show the laundry's location rather
 * than the owner's own address (that one is captured separately, privately, in
 * EditListingLocationPanel). They are resolved server-side from the laundry's
 * profile, so this panel must not send them: a client-supplied address is exactly
 * the disagreement the single call exists to prevent.
 *
 * WHAT onSubmit IS STILL FOR
 * The wizard's own bookkeeping - marking the tab updated and running the
 * new-listing-flow redirect - hangs off a successful `onSubmit`. It is called with
 * no listing attributes, so `ownListings.update({ id })` is a pure read-back whose
 * expanded response carries the metadata the server just wrote (verified against
 * Dev). That is what refreshes the Redux entity behind EditListingWizard's
 * tabCompleted check, so the LAUNDRY tab registers as complete and the owner is
 * not bounced back.
 *
 * THE PICKER LOCKS WHILE THE GARMENT IS AT THE LAUNDRY
 * `listing.metadata.onLaundry` is written only by the server (see
 * server/api-util/listingCustody.js), which is what makes it safe to read here.
 * When it is true the cards stop being selectable and a notice says why;
 * re-saving the SAME laundry is still allowed so the wizard tab never dead-ends.
 * The lock in this file is UX, not enforcement - the server re-reads `onLaundry`
 * and the transaction list, so a page loaded while the garment was home and
 * submitted after it came back is refused there.
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
  // 409 from /api/listing-laundry-assignment. Two conditions can produce it and
  // they are different facts about the owner's own garment - "it is at the studio"
  // and "somebody is renting it" are not interchangeable news - so this holds the
  // server's `data.reason` and the UI picks the matching translated string. The
  // server's own `statusText` is deliberately NOT shown: it is English, written
  // for logs and curl, and this page is translated.
  const [lockError, setLockError] = useState(null);
  // Any other failure. Kept distinct from lockError on purpose: telling an owner
  // "the garment is at the laundry" because their wifi dropped would be a lie
  // about their own garment.
  const [saveError, setSaveError] = useState(false);

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

      {/* `role="alert"` so a refusal arriving after a button press is announced,
          rather than silently appearing above a form the owner has scrolled past.
          An unrecognised reason falls back to the at-the-laundry string: it is the
          commoner of the two and, unlike a blank, it at least tells the owner the
          save was refused rather than lost. */}
      {lockError ? (
        <p className={css.error} role="alert">
          <FormattedMessage
            id={
              lockError === 'active-transaction'
                ? 'EditListingLaundryPanel.activeTransactionError'
                : 'EditListingLaundryPanel.laundryLockedError'
            }
          />
        </p>
      ) : null}

      {saveError ? (
        <p className={css.error} role="alert">
          <FormattedMessage id="EditListingLaundryPanel.assignmentFailed" />
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
          setLockError(null);
          setSaveError(false);

          // No listing yet would mean the create flow's very first tab, which this
          // is not (LAUNDRY always follows DETAILS, so a draft already exists).
          // There is no longer a fallback path for it: without a listing id the
          // server cannot be asked to write, and the browser cannot write metadata
          // at all. Surfacing it as a failure is honest; silently writing nothing
          // and passing the tab is what used to leave owners stuck later.
          const listingId = listing?.id?.uuid;
          if (!listingId) {
            setSaveError(true);
            return;
          }

          // THE WRITE. The server validates ownership, the active-transaction
          // condition and `onLaundry`, then writes the id plus the three derived
          // fields. Nothing about the assignment is sent through onSubmit.
          return assignListingLaundry({
            listingId,
            assignedLaundryId: selectedLaundry.id,
          })
            .then(() =>
              // Pure read-back: no attributes, so this writes nothing and returns
              // the listing with the metadata the server has just set. Lets the
              // wizard mark the tab updated and run its redirect off a listing
              // entity that actually reflects the save.
              onSubmit({})
            )
            .catch(e => {
              if (e?.status === 409) {
                // The server names which condition refused it (api-util/sdk.js's
                // handleError forwards `error.data` untouched).
                setLockError(e?.data?.reason || 'on-laundry');
              } else {
                setSaveError(true);
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
