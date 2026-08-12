import React, { useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { isLaundryUser } from '../../util/userHelpers';
import {
  categoryPricingFromFormValues,
  categoryPricingToFormValues,
} from '../../util/fieldHelpers';
import { types as sdkTypes } from '../../util/sdkLoader';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, Page, UserNav, LayoutSideNavigation } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';
import NotFoundPage from '../NotFoundPage/NotFoundPage';

import LaundryOpsNav from '../LaundryOpsPage/LaundryOpsNav';

import LaundryProfileForm from './LaundryProfileForm/LaundryProfileForm';

import { updateProfile } from './LaundryProfilePage.duck';
import css from './LaundryProfilePage.module.css';

const { LatLng } = sdkTypes;

// The address field's validator (autocompletePlaceSelected) requires
// `origin instanceof LatLng` — a plain { lat, lng } fails it.
//
// Which origin you get back depends on who wrote the profile. A save through this form
// sends a real LatLng, and the SDK's transit codec round-trips it as one. A profile
// seeded through the Integration API or a script (scripts/set-laundry-role.js) stores
// plain JSON, and publicData is opaque to the codec, so it reads back as a bare object.
// Those laundries then hit a form that is permanently `invalid`: every field looks
// correct, no error is shown anywhere, and "Save changes" simply never enables — there
// is no way for them to configure their studio at all.
//
// Rehydrating here costs nothing and makes both origins behave identically.
const toLatLng = origin => {
  if (origin instanceof LatLng) {
    return origin;
  }
  const { lat, lng } = origin || {};
  return Number.isFinite(lat) && Number.isFinite(lng) ? new LatLng(lat, lng) : null;
};

// Build the form's initialValues from the currentUser entity.
// Mirrors EditListingLocationPanel's getInitialValues: the address field is
// reconstructed as { search, selectedPlace: { address, origin } } so it round-trips
// through FieldLocationAutocompleteInput.
const getInitialValues = currentUser => {
  const { publicData = {}, privateData = {} } = currentUser?.attributes?.profile || {};
  const { laundryProfile = {}, acceptedCategories = [] } = publicData;
  const { studioName, address, businessHours } = laundryProfile;
  const origin = toLatLng(laundryProfile.origin);
  // No cleaningFee is read: fees are marketplace-level server env configuration now
  // (CLEANING_FEE_<CATEGORY_ID>, see server/api-util/cleaningFeeEnv.js), the form has no
  // input for one, and any value still stored on an old profile is dead data.
  const { turnaroundDays } = privateData;

  return {
    studioName,
    businessHours,
    turnaroundDays,
    // The per-category table is flattened into one form field per value
    // (`categoryPricing__turnaroundDays__dresses`). Flat, not nested, because React
    // Final Form reads dots in a field name as a path and Console category ids are
    // free-form operator input — see categoryPricingFieldName.
    //
    // EVERY stored entry is seeded, including categories the studio no longer accepts.
    // Those render no input, but final-form keeps unbound initialValues in `values`,
    // so they survive a save instead of being silently pruned by a form that simply
    // wasn't showing them. The form surfaces them separately so they can be cleared on
    // purpose.
    ...categoryPricingToFormValues(privateData.categoryPricing),
    // Array in, array out. The stored list can mix Console category ids (what the
    // picker writes) with free text saved before the picker existed; the form keeps
    // both in this one field so a save can never drop the legacy half. See
    // LaundryProfileForm's docblock.
    acceptedCategories: Array.isArray(acceptedCategories) ? acceptedCategories : [],
    location: address && origin ? { search: address, selectedPlace: { address, origin } } : null,
  };
};

/**
 * The editable part of the page. Split out from LaundryProfilePageComponent
 * (and mounted with key={currentUser.id.uuid}) for a specific reason:
 *
 * `initialValues` has to be snapshotted in local state, because
 * FieldLocationAutocompleteInput keeps no internal state and re-rendering with
 * fresh initialValues from props during the update XHR would blow away what
 * the laundry just typed. But a `useState` initializer runs exactly ONCE, on
 * first render — and on a hard load of /laundry-profile, `currentUser` is null
 * on first render (ClientApp fetches it asynchronously). Snapshotting there
 * captured an all-undefined object permanently: the laundry opened the page,
 * saw a blank form, retyped the required fields, saved — and wiped their
 * configured `turnaroundDays`, silently resizing every future availability
 * buffer to the DEFAULT_LAUNDRY_BUFFER_DAYS env fallback.
 *
 * Keeping the snapshot in a child that is only mounted once `currentUser` is
 * loaded (and remounted via `key` if the user identity ever changes) means the
 * initializer can only ever run against real data, while preserving the
 * don't-clobber-in-flight-edits behaviour the snapshot was there for.
 *
 * @param {Object} props
 * @param {propTypes.currentUser} props.currentUser - a LOADED current user
 * @returns {JSX.Element}
 */
const LaundryProfileFormSection = props => {
  const { currentUser, onUpdateProfile, updateProfileInProgress, updateProfileError } = props;

  const [state, setState] = useState({ initialValues: getInitialValues(currentUser) });

  const handleSubmit = values => {
    const { studioName, businessHours, turnaroundDays, acceptedCategories, location } = values;
    const { address, origin } = location?.selectedPlace || {};

    // The category table hands back an array of Console category ids, plus any legacy
    // free-text values that were already stored and haven't been removed. Normalised
    // here (dedupe, drop blanks) so publicData never picks up empties from either side.
    const acceptedCategoriesArray = [
      ...new Set(
        (Array.isArray(acceptedCategories) ? acceptedCategories : [])
          .filter(category => typeof category === 'string')
          .map(category => category.trim())
          .filter(category => category.length > 0)
      ),
    ];

    const { privateData: currentPrivateData = {} } = currentUser?.attributes?.profile || {};

    // Belt and braces on the studio-wide turnaround: never let an absent field erase a
    // stored one. A wiped turnaround silently changes how long every listing this studio
    // handles is blocked for after a rental. Clearing it deliberately is not a Phase 1
    // requirement; not destroying it is.
    const preserved = (submitted, existing) =>
      typeof submitted === 'number' && Number.isFinite(submitted) ? submitted : existing;

    const nextTurnaroundDays = preserved(turnaroundDays, currentPrivateData.turnaroundDays);

    // Rebuild the nested table from the flat fields. Cleared inputs drop out entirely
    // rather than being stored as null: an empty box means "use the studio-wide value",
    // and that is expressed by the key's absence, not by a row full of nulls.
    const nextCategoryPricing = categoryPricingFromFormValues(values);

    // Only the keys this page owns are sent. Sharetribe merges top-level
    // publicData/privateData keys, so re-sending the whole existing blob would
    // only widen the lost-update window against a concurrent write.
    const profile = {
      publicData: {
        laundryProfile: { studioName, address, origin, businessHours },
        acceptedCategories: acceptedCategoriesArray,
      },
      privateData: {
        turnaroundDays: nextTurnaroundDays,
        categoryPricing: nextCategoryPricing,
      },
    };

    // Cache the values we just saved so the form doesn't revert to stale
    // initialValues while the update request is in flight.
    setState({
      initialValues: {
        studioName,
        businessHours,
        turnaroundDays: nextTurnaroundDays,
        acceptedCategories: acceptedCategoriesArray,
        ...categoryPricingToFormValues(nextCategoryPricing),
        location:
          address && origin ? { search: address, selectedPlace: { address, origin } } : null,
      },
    });

    onUpdateProfile(profile);
  };

  return (
    <LaundryProfileForm
      className={css.form}
      initialValues={state.initialValues}
      onSubmit={handleSubmit}
      updateProfileError={updateProfileError}
      updateInProgress={updateProfileInProgress}
    />
  );
};

/**
 * LaundryProfilePage
 *
 * Laundry-only settings page for the studio profile: studio name, address,
 * business hours, studio-wide turnaround in days, and one table of accepted garment
 * categories carrying a turnaround per top-level category. Writes to
 * publicData.laundryProfile, publicData.acceptedCategories and privateData
 * (turnaroundDays, categoryPricing) on the laundry's own user profile via the ordinary
 * Marketplace API (sdk.currentUser.updateProfile) — no Integration API involved. It
 * writes NO cleaning fee: fees are marketplace-level server env configuration
 * (CLEANING_FEE_<CATEGORY_ID>), not something a studio sets. The per-category table is
 * privateData rather than publicData because a studio's capacity is a commercial input:
 * the laundry and the operator see it, nobody else.
 * Access is gated to users flagged via isLaundryUser (see
 * src/util/userHelpers.js); everyone else sees NotFoundPage, matching the pattern
 * used by other role-gated pages in this template (e.g. ProfilePage, InboxPage).
 *
 * @param {Object} props
 * @param {propTypes.currentUser} [props.currentUser] - The current user
 * @param {boolean} props.scrollingDisabled - Whether the scrolling is disabled
 * @param {Function} props.onUpdateProfile - The submit profile update function
 * @param {boolean} [props.updateProfileInProgress] - Whether the update is in progress
 * @param {propTypes.error} [props.updateProfileError] - The update profile error
 * @returns {JSX.Element}
 */
export const LaundryProfilePageComponent = props => {
  const intl = useIntl();
  const {
    currentUser,
    scrollingDisabled,
    onUpdateProfile,
    updateProfileInProgress = false,
    updateProfileError,
    staticContext,
  } = props;

  const currentUserLoaded = !!currentUser?.id;

  if (currentUserLoaded && !isLaundryUser(currentUser)) {
    return <NotFoundPage staticContext={staticContext} />;
  }

  if (!currentUserLoaded) {
    // currentUser hasn't loaded yet (e.g. straight after login) - avoid a
    // flash of NotFoundPage before we know whether this user is a laundry.
    return null;
  }

  const title = intl.formatMessage({ id: 'LaundryProfilePage.title' });

  // Mockup 03.jpg shows Studio settings inside the ops shell, with the same
  // sidebar as every other /laundry/* screen. The sidebar's own "Settings"
  // entry already links here, so rendering it keeps the ops navigation
  // reachable instead of dead-ending on this page.
  const studioName = currentUser?.attributes?.profile?.publicData?.laundryProfile?.studioName;

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer
              desktopClassName={css.desktopTopbar}
              mobileClassName={css.mobileTopbar}
            />
            <UserNav currentPage="LaundryProfilePage" showLaundryProfileLink showManageListingsLink />
          </>
        }
        sideNav={<LaundryOpsNav currentPage="LaundryProfilePage" studioName={studioName} />}
        useAccountSettingsNav={false}
        footer={<FooterContainer />}
        mainColumnClassName={css.opsMain}
        sideNavClassName={css.opsSideNav}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1" className={css.pageTitle}>
            <FormattedMessage id="LaundryProfilePage.heading" />
          </H3>
          {/* key: remount (and re-snapshot initialValues) if the user
              identity ever changes. currentUser is guaranteed loaded here. */}
          <LaundryProfileFormSection
            key={currentUser.id.uuid}
            currentUser={currentUser}
            onUpdateProfile={onUpdateProfile}
            updateProfileInProgress={updateProfileInProgress}
            updateProfileError={updateProfileError}
          />
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const { updateProfileInProgress, updateProfileError } = state.LaundryProfilePage;
  return {
    currentUser,
    scrollingDisabled: isScrollingDisabled(state),
    updateProfileInProgress,
    updateProfileError,
  };
};

const mapDispatchToProps = dispatch => ({
  onUpdateProfile: values => dispatch(updateProfile(values)),
});

const LaundryProfilePage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(LaundryProfilePageComponent);

export default LaundryProfilePage;
