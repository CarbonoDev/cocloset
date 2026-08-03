import React, { useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { isLaundryUser } from '../../util/userHelpers';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, Page, UserNav, LayoutSideNavigation } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';
import NotFoundPage from '../NotFoundPage/NotFoundPage';

import LaundryOpsNav from '../LaundryOpsPage/LaundryOpsNav';

import LaundryProfileForm from './LaundryProfileForm/LaundryProfileForm';

import { updateProfile } from './LaundryProfilePage.duck';
import css from './LaundryProfilePage.module.css';

// Build the form's initialValues from the currentUser entity.
// Mirrors EditListingLocationPanel's getInitialValues: the address field is
// reconstructed as { search, selectedPlace: { address, origin } } so it round-trips
// through FieldLocationAutocompleteInput.
const getInitialValues = currentUser => {
  const { publicData = {}, privateData = {} } = currentUser?.attributes?.profile || {};
  const { laundryProfile = {}, acceptedCategories = [] } = publicData;
  const { studioName, address, origin, businessHours } = laundryProfile;
  const { turnaroundHours, cleaningFee } = privateData;

  return {
    studioName,
    businessHours,
    turnaroundHours,
    cleaningFee,
    acceptedCategories: (acceptedCategories || []).join(', '),
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
 * configured `cleaningFee`, silently repricing every future booking to the
 * DEFAULT_CLEANING_FEE env fallback.
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
    const {
      studioName,
      businessHours,
      turnaroundHours,
      cleaningFee,
      acceptedCategories,
      location,
    } = values;
    const { address, origin } = location?.selectedPlace || {};

    const acceptedCategoriesArray = (acceptedCategories || '')
      .split(',')
      .map(category => category.trim())
      .filter(category => category.length > 0);

    const { privateData: currentPrivateData = {} } = currentUser?.attributes?.profile || {};

    // Belt and braces on the two money/scheduling values: `cleaningFee` has no
    // `validate` on the form, so an absent value would submit as null. Never
    // let an absent field erase a stored one — a wiped cleaningFee silently
    // changes what every future customer is charged. Clearing them
    // deliberately is not a Phase 1 requirement; not destroying them is.
    const preserved = (submitted, existing) =>
      typeof submitted === 'number' && Number.isFinite(submitted) ? submitted : existing;

    const nextTurnaroundHours = preserved(turnaroundHours, currentPrivateData.turnaroundHours);
    const nextCleaningFee = preserved(cleaningFee, currentPrivateData.cleaningFee);

    // Only the keys this page owns are sent. Sharetribe merges top-level
    // publicData/privateData keys, so re-sending the whole existing blob would
    // only widen the lost-update window against a concurrent write.
    const profile = {
      publicData: {
        laundryProfile: { studioName, address, origin, businessHours },
        acceptedCategories: acceptedCategoriesArray,
      },
      privateData: {
        turnaroundHours: nextTurnaroundHours,
        cleaningFee: nextCleaningFee,
      },
    };

    // Cache the values we just saved so the form doesn't revert to stale
    // initialValues while the update request is in flight.
    setState({
      initialValues: {
        studioName,
        businessHours,
        turnaroundHours: nextTurnaroundHours,
        cleaningFee: nextCleaningFee,
        acceptedCategories: acceptedCategoriesArray.join(', '),
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
 * business hours, default turnaround hours, cleaning fee, and accepted garment
 * categories. Writes to publicData.laundryProfile, publicData.acceptedCategories
 * and privateData (turnaroundHours, cleaningFee) on the laundry's own user profile
 * via the ordinary Marketplace API (sdk.currentUser.updateProfile) — no Integration
 * API involved. Access is gated to users flagged via isLaundryUser (see
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
            <UserNav currentPage="LaundryProfilePage" />
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
