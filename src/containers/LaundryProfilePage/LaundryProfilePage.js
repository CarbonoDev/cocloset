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

  // FieldLocationAutocompleteInput doesn't keep internal state, so re-rendering
  // with fresh initialValues from props during the update XHR would blow away
  // what the user just typed — cache initialValues in local state instead,
  // same approach as EditListingLocationPanel.
  const [state, setState] = useState({ initialValues: getInitialValues(currentUser) });

  const currentUserLoaded = !!currentUser?.id;

  if (currentUserLoaded && !isLaundryUser(currentUser)) {
    return <NotFoundPage staticContext={staticContext} />;
  }

  if (!currentUserLoaded) {
    // currentUser hasn't loaded yet (e.g. straight after login) - avoid a
    // flash of NotFoundPage before we know whether this user is a laundry.
    return null;
  }

  const handleSubmit = values => {
    const {
      studioName,
      businessHours,
      turnaroundHours,
      cleaningFee,
      acceptedCategories,
      location,
    } = values;
    const {
      selectedPlace: { address, origin },
    } = location;

    const acceptedCategoriesArray = (acceptedCategories || '')
      .split(',')
      .map(category => category.trim())
      .filter(category => category.length > 0);

    const { publicData: currentPublicData = {}, privateData: currentPrivateData = {} } =
      currentUser?.attributes?.profile || {};

    const profile = {
      publicData: {
        ...currentPublicData,
        laundryProfile: { studioName, address, origin, businessHours },
        acceptedCategories: acceptedCategoriesArray,
      },
      privateData: {
        ...currentPrivateData,
        turnaroundHours,
        cleaningFee,
      },
    };

    // Cache the values we just saved so the form doesn't revert to stale
    // initialValues while the update request is in flight.
    setState({
      initialValues: {
        studioName,
        businessHours,
        turnaroundHours,
        cleaningFee,
        acceptedCategories: acceptedCategoriesArray.join(', '),
        location: { search: address, selectedPlace: { address, origin } },
      },
    });

    onUpdateProfile(profile);
  };

  const title = intl.formatMessage({ id: 'LaundryProfilePage.title' });

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
        sideNav={null}
        useAccountSettingsNav={false}
        footer={<FooterContainer />}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1">
            <FormattedMessage id="LaundryProfilePage.heading" />
          </H3>
          <LaundryProfileForm
            className={css.form}
            initialValues={state.initialValues}
            onSubmit={handleSubmit}
            updateProfileError={updateProfileError}
            updateInProgress={updateProfileInProgress}
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
