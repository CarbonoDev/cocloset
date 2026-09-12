import React, { useEffect, useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import classNames from 'classnames';

import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { REVIEW_TYPE_OF_PROVIDER, REVIEW_TYPE_OF_CUSTOMER, propTypes } from '../../util/types';
import {
  NO_ACCESS_PAGE_USER_PENDING_APPROVAL,
  NO_ACCESS_PAGE_VIEW_LISTINGS,
  PROFILE_PAGE_PENDING_APPROVAL_VARIANT,
} from '../../util/urlHelpers';
import {
  isErrorNoViewingPermission,
  isErrorUserPendingApproval,
  isForbiddenError,
  isNotFoundError,
} from '../../util/errors';
import {
  getDetailCustomFieldValue,
  getFieldValue,
  pickCustomFieldProps,
} from '../../util/fieldHelpers';
import {
  getCurrentUserTypeRoles,
  hasPermissionToViewData,
  isLaundryUser,
  isUserAuthorized,
} from '../../util/userHelpers';
import { richText } from '../../util/richText';
import { BUSINESS_DAYS } from '../../util/businessHours';

import { isScrollingDisabled } from '../../ducks/ui.duck';
import { getMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import {
  Heading,
  H2,
  H4,
  Page,
  AvatarLarge,
  NamedLink,
  ListingCard,
  Reviews,
  ButtonTabNavHorizontal,
  LayoutSideNavigation,
  NamedRedirect,
  CustomExtendedDataSection,
} from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';
import NotFoundPage from '../../containers/NotFoundPage/NotFoundPage';

import css from './ProfilePage.module.css';

const MAX_MOBILE_SCREEN_WIDTH = 768;
const MIN_LENGTH_FOR_LONG_WORDS = 20;

export const AsideContent = props => {
  const { user, displayName, showLinkToProfileSettingsPage } = props;
  return (
    <div className={css.asideContent}>
      <AvatarLarge className={css.avatar} user={user} disableProfileLink />
      <H2 as="h1" className={css.mobileHeading}>
        {displayName ? (
          <FormattedMessage id="ProfilePage.mobileHeading" values={{ name: displayName }} />
        ) : null}
      </H2>
      {showLinkToProfileSettingsPage ? (
        <>
          <NamedLink className={css.editLinkMobile} name="ProfileSettingsPage">
            <FormattedMessage id="ProfilePage.editProfileLinkMobile" />
          </NamedLink>
          <NamedLink className={css.editLinkDesktop} name="ProfileSettingsPage">
            <FormattedMessage id="ProfilePage.editProfileLinkDesktop" />
          </NamedLink>
        </>
      ) : null}
    </div>
  );
};

export const ReviewsErrorMaybe = props => {
  const { queryReviewsError } = props;
  return queryReviewsError ? (
    <p className={css.error}>
      <FormattedMessage id="ProfilePage.loadingReviewsFailed" />
    </p>
  ) : null;
};

export const MobileReviews = props => {
  const { reviews, queryReviewsError } = props;
  const reviewsOfProvider = reviews.filter(r => r.attributes.type === REVIEW_TYPE_OF_PROVIDER);
  const reviewsOfCustomer = reviews.filter(r => r.attributes.type === REVIEW_TYPE_OF_CUSTOMER);
  return (
    <div className={css.mobileReviews}>
      <H4 as="h2" className={css.mobileReviewsTitle}>
        <FormattedMessage
          id="ProfilePage.reviewsFromMyCustomersTitle"
          values={{ count: reviewsOfProvider.length }}
        />
      </H4>
      <ReviewsErrorMaybe queryReviewsError={queryReviewsError} />
      <Reviews reviews={reviewsOfProvider} />
      <H4 as="h2" className={css.mobileReviewsTitle}>
        <FormattedMessage
          id="ProfilePage.reviewsAsACustomerTitle"
          values={{ count: reviewsOfCustomer.length }}
        />
      </H4>
      <ReviewsErrorMaybe queryReviewsError={queryReviewsError} />
      <Reviews reviews={reviewsOfCustomer} />
    </div>
  );
};

export const DesktopReviews = props => {
  const { reviews, queryReviewsError, userTypeRoles, intl } = props;
  const { customer: isCustomerUserType, provider: isProviderUserType } = userTypeRoles;

  const initialReviewState = !isProviderUserType
    ? REVIEW_TYPE_OF_CUSTOMER
    : REVIEW_TYPE_OF_PROVIDER;
  const [showReviewsType, setShowReviewsType] = useState(initialReviewState);

  const reviewsOfProvider = reviews.filter(r => r.attributes.type === REVIEW_TYPE_OF_PROVIDER);
  const reviewsOfCustomer = reviews.filter(r => r.attributes.type === REVIEW_TYPE_OF_CUSTOMER);
  const isReviewTypeProviderSelected = showReviewsType === REVIEW_TYPE_OF_PROVIDER;
  const isReviewTypeCustomerSelected = showReviewsType === REVIEW_TYPE_OF_CUSTOMER;
  const providerReviewsMaybe = isProviderUserType
    ? [
        {
          text: (
            <Heading as="h3" rootClassName={css.desktopReviewsTitle}>
              <FormattedMessage
                id="ProfilePage.reviewsFromMyCustomersTitle"
                values={{ count: reviewsOfProvider.length }}
              />
            </Heading>
          ),
          selected: isReviewTypeProviderSelected,
          onClick: () => setShowReviewsType(REVIEW_TYPE_OF_PROVIDER),
        },
      ]
    : [];

  const customerReviewsMaybe = isCustomerUserType
    ? [
        {
          text: (
            <Heading as="h3" rootClassName={css.desktopReviewsTitle}>
              <FormattedMessage
                id="ProfilePage.reviewsAsACustomerTitle"
                values={{ count: reviewsOfCustomer.length }}
              />
            </Heading>
          ),
          selected: isReviewTypeCustomerSelected,
          onClick: () => setShowReviewsType(REVIEW_TYPE_OF_CUSTOMER),
        },
      ]
    : [];
  const desktopReviewTabs = [...providerReviewsMaybe, ...customerReviewsMaybe];

  return (
    <div className={css.desktopReviews}>
      <div className={css.desktopReviewsWrapper}>
        <ButtonTabNavHorizontal
          className={css.desktopReviewsTabNav}
          tabs={desktopReviewTabs}
          ariaLabel={intl.formatMessage({ id: 'ProfilePage.screenreader.reviewsNav' })}
        />

        <ReviewsErrorMaybe queryReviewsError={queryReviewsError} />

        {isReviewTypeProviderSelected ? (
          <Reviews reviews={reviewsOfProvider} />
        ) : (
          <Reviews reviews={reviewsOfCustomer} />
        )}
      </div>
    </div>
  );
};

export const CustomUserFields = props => {
  const { publicData, metadata, userFieldConfig, intl } = props;

  const shouldPickUserField = fieldConfig =>
    ['public', 'metadata'].includes(fieldConfig?.scope) &&
    fieldConfig?.showConfig?.displayInProfile !== false;
  const propsForCustomFields =
    pickCustomFieldProps(
      { publicData, metadata },
      userFieldConfig,
      'userType',
      shouldPickUserField
    ) || [];

  const pickUserFields = (filteredConfigs, config) => {
    const { key, schemaType, enumOptions, userTypeConfig = {}, showConfig = {} } = config;
    const { limitToUserTypeIds, userTypeIds } = userTypeConfig;
    const userType = publicData.userType;
    const isTargetUserType = !limitToUserTypeIds || userTypeIds.includes(userType);

    const { label, displayInProfile } = showConfig;
    const publicDataValue = getFieldValue(publicData, key);
    const metadataValue = getFieldValue(metadata, key);
    const value = publicDataValue !== null ? publicDataValue : metadataValue;

    if (displayInProfile && isTargetUserType && value !== null) {
      const detailValue = getDetailCustomFieldValue(
        enumOptions,
        value,
        schemaType,
        key,
        label,
        intl,
        'ProfilePage'
      );

      return detailValue ? filteredConfigs.concat(detailValue) : filteredConfigs;
    }
    return filteredConfigs;
  };
  const sectionDetailsProps = {
    ...props,
    fieldConfigs: userFieldConfig,
    heading: 'ProfilePage.detailsTitle',
    rootClassName: css.userFieldSection,
  };

  return (
    <CustomExtendedDataSection
      sectionDetailsProps={sectionDetailsProps}
      propsForCustomFields={propsForCustomFields}
      idPrefix="profilePage"
      pickExtendedDataFields={pickUserFields}
      rootClassName={css.userFieldSection}
    />
  );
};

export const MainContent = props => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    userShowError,
    bio,
    displayName,
    listings,
    queryListingsError,
    reviews = [],
    queryReviewsError,
    publicData,
    metadata,
    userFieldConfig,
    intl,
    hideReviews,
    userTypeRoles,
    isLaundry,
    laundryProfile = {},
  } = props;

  const hasListings = listings.length > 0;
  const hasMatchMedia = typeof window !== 'undefined' && window?.matchMedia;
  const isMobileLayout =
    mounted && hasMatchMedia
      ? window.matchMedia(`(max-width: ${MAX_MOBILE_SCREEN_WIDTH}px)`)?.matches
      : true;

  // A laundry's neighborhood is a fact about the shop, resolved from its address on
  // LaundryProfileForm - not the plain-member field below, which a laundry never gets
  // on its own settings page (see ProfileSettingsForm's isLaundry gate) so the two
  // values can never disagree.
  //
  // Written by the member on their settings page; absent on a profile that has not said.
  const neighborhood = isLaundry ? laundryProfile.neighborhood : publicData?.neighborhood;

  // BUSINESS HOURS, AS A LIST - NOT THE GROUPED SENTENCE.
  //
  //   > "los horarios... actualmente salen asi: Mon 09:00-18:00, Tue 09:00-14:00...
  //   >  Se muestren mejor en una lista, es más cómodo leer asi" (Jonathan, 2026-09-11)
  //
  // `businessHours` (the one-line summary LaundryProfileForm derives and stores
  // alongside the grid) is what that comma-joined sentence IS - so this reads the
  // structured `businessHoursByDay` instead and renders one line per day. Only days
  // the studio is actually open appear at all: `businessHoursByDay` never carries a
  // closed day (see util/businessHours.js's `toBusinessHoursByDay`).
  const businessHoursByDay = laundryProfile.businessHoursByDay;
  const businessHoursEntries = BUSINESS_DAYS.filter(day => businessHoursByDay?.[day]).map(day => ({
    day,
    ...businessHoursByDay[day],
  }));
  // A studio that saved its profile before the per-day grid existed has only the old
  // summary sentence stored - shown verbatim rather than left blank, since some
  // information beats none until the studio saves again and gets the list.
  const hasBusinessHoursList = businessHoursEntries.length > 0;

  // A laundry's "about" text is its Description (LaundryProfileForm's `description`),
  // not the base `bio` attribute - see ProfileSettingsForm, which hides Bio entirely
  // for a laundry so there is only ever one answer to "about this account".
  const laundryDescription = laundryProfile.description;
  const hasBio = isLaundry ? !!laundryDescription : !!bio;
  const bioWithLinks = richText(isLaundry ? laundryDescription : bio, {
    linkify: true,
    longWordMinLength: MIN_LENGTH_FOR_LONG_WORDS,
    longWordClass: css.longWord,
  });

  const listingsContainerClasses = classNames(css.listingsContainer, {
    [css.withBioMissingAbove]: !hasBio,
  });

  if (userShowError || queryListingsError) {
    return (
      <p className={css.error}>
        <FormattedMessage id="ProfilePage.loadingDataFailed" />
      </p>
    );
  }
  return (
    <div>
      <H2 as="h1" className={isLaundry ? css.laundryDesktopHeading : css.desktopHeading}>
        {/* A LAUNDRY'S HEADING IS JUST ITS BUSINESS NAME.
              > "Solo el Business Name reemplazando a 'Hello my name is [user name]'"
              >  (Jonathan, 2026-09-11)

            No "Hello, I'm" framing - a studio is a place, not a person introducing
            itself. Falls back to displayName only if studioName was never set, so a
            laundry mid-onboarding still gets a heading rather than a blank one. */}
        {isLaundry ? (
          <FormattedMessage
            id="ProfilePage.laundryDesktopHeading"
            values={{ name: laundryProfile.studioName || displayName }}
          />
        ) : (
          <FormattedMessage id="ProfilePage.desktopHeading" values={{ name: displayName }} />
        )}
      </H2>
      {isLaundry ? (
        // STORE ADDRESS, NEIGHBORHOOD, BUSINESS HOURS, DESCRIPTION - ONE STYLED
        // PANEL (2026-09-12: "El estilo era para la ruta /u/:id, no el form").
        // Reuses the brand-accent card + eyebrow-label treatment already
        // established for the landing page's own sections
        // (SectionCoclosetSteps.module.css's `.sectionTitle`), which is where this
        // page's restyle actually belongs per Jonathan - LaundryProfileForm itself
        // is unchanged.
        <div className={css.laundryDetails}>
          {laundryProfile.address ? (
            <div className={css.laundryDetailRow}>
              <span className={css.laundryDetailLabel}>
                <FormattedMessage id="ProfilePage.laundryDetail.address" />
              </span>
              <p className={css.laundryDetailValue}>{laundryProfile.address}</p>
            </div>
          ) : null}
          {neighborhood ? (
            <div className={css.laundryDetailRow}>
              <span className={css.laundryDetailLabel}>
                <FormattedMessage id="ProfilePage.laundryDetail.neighborhood" />
              </span>
              <p className={css.laundryDetailValue}>{neighborhood}</p>
            </div>
          ) : null}
          {hasBusinessHoursList ? (
            <div className={css.laundryDetailRow}>
              <span className={css.laundryDetailLabel}>
                <FormattedMessage id="ProfilePage.laundryDetail.hours" />
              </span>
              <ul className={css.businessHoursList}>
                {businessHoursEntries.map(({ day, open, close }) => (
                  <li key={day} className={css.businessHoursRow}>
                    <span className={css.businessHoursDay}>
                      <FormattedMessage id={`ProfilePage.day.${day}`} />
                    </span>
                    <span>
                      {open}–{close}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : laundryProfile.businessHours ? (
            // Saved before the per-day grid existed - the old sentence, verbatim.
            <div className={css.laundryDetailRow}>
              <span className={css.laundryDetailLabel}>
                <FormattedMessage id="ProfilePage.laundryDetail.hours" />
              </span>
              <p className={css.laundryDetailValue}>{laundryProfile.businessHours}</p>
            </div>
          ) : null}
          {hasBio ? (
            <div className={css.laundryDetailRow}>
              <span className={css.laundryDetailLabel}>
                <FormattedMessage id="ProfilePage.laundryDetail.about" />
              </span>
              <p className={css.laundryDetailValue}>{bioWithLinks}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {/* Where this member is, in their own words - written on the settings page
              (Jonathan, 2026-09-03). Directly under the name because that is what it
              qualifies: a wardrobe organised around neighbourhoods answers "is this
              person near me" before it answers anything else. Absent when they have
              not said, rather than rendered as an empty line. */}
          {/* The member's own words, rendered as content rather than through a message -
              the same treatment the bio below gets, and for the same reason: there is no
              UI text here to translate, only what they typed. */}
          {neighborhood ? <p className={css.neighborhood}>{neighborhood}</p> : null}
          {hasBio ? <p className={css.bio}>{bioWithLinks}</p> : null}
        </>
      )}

      {displayName ? (
        <CustomUserFields
          publicData={publicData}
          metadata={metadata}
          userFieldConfig={userFieldConfig}
          intl={intl}
        />
      ) : null}

      {hasListings ? (
        <div className={listingsContainerClasses}>
          <H4 as="h2" className={css.listingsTitle}>
            <FormattedMessage id="ProfilePage.listingsTitle" values={{ count: listings.length }} />
          </H4>
          <ul className={css.listings}>
            {listings.map(l => (
              <li className={css.listing} key={l.id.uuid}>
                <ListingCard listing={l} showAuthorInfo={false} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hideReviews ? null : isMobileLayout ? (
        <MobileReviews
          reviews={reviews}
          queryReviewsError={queryReviewsError}
          userTypeRoles={userTypeRoles}
        />
      ) : (
        <DesktopReviews
          reviews={reviews}
          queryReviewsError={queryReviewsError}
          userTypeRoles={userTypeRoles}
          intl={intl}
        />
      )}
    </div>
  );
};

/**
 * ProfilePageComponent
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.scrollingDisabled - Whether the scrolling is disabled
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {boolean} props.useCurrentUser - Whether to use the current user
 * @param {propTypes.user|propTypes.currentUser} props.user - The user
 * @param {propTypes.error} props.userShowError - The user show error
 * @param {propTypes.error} props.queryListingsError - The query listings error
 * @param {Array<propTypes.listing|propTypes.ownListing>} props.listings - The listings
 * @param {Array<propTypes.review>} props.reviews - The reviews
 * @param {propTypes.error} props.queryReviewsError - The query reviews error
 * @returns {JSX.Element} ProfilePageComponent
 */
export const ProfilePageComponent = props => {
  const config = useConfiguration();
  const intl = useIntl();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    scrollingDisabled,
    params: pathParams,
    currentUser,
    useCurrentUser,
    userShowError,
    user,
    ...rest
  } = props;
  const isVariant = pathParams.variant?.length > 0;
  const isPreview = isVariant && pathParams.variant === PROFILE_PAGE_PENDING_APPROVAL_VARIANT;

  // Stripe's onboarding needs a business URL for each seller, but the profile page can be
  // too empty for the provider at the time they are creating their first listing.
  // To remedy the situation, we redirect Stripe's crawler to the landing page of the marketplace.
  // TODO: When there's more content on the profile page, we should consider by-passing this redirection.
  const searchParams = rest?.location?.search;
  const isStorefront = searchParams
    ? new URLSearchParams(searchParams)?.get('mode') === 'storefront'
    : false;
  if (isStorefront) {
    return <NamedRedirect name="LandingPage" />;
  }

  const isCurrentUser = currentUser?.id && currentUser?.id?.uuid === pathParams.id;
  const profileUser = useCurrentUser ? currentUser : user;
  const { bio, displayName, publicData, metadata } = profileUser?.attributes?.profile || {};
  // `metadata` is public-read (Integration-API-write-only, same visibility rule as a
  // listing's), so this works for ANY visitor viewing a laundry's page, not just the
  // laundry viewing its own - unlike LaundryProfilePage/LaundryOpsPage, which gate on
  // `currentUser` instead.
  const isLaundry = isLaundryUser(profileUser);
  const laundryProfile = publicData?.laundryProfile || {};
  const { userFields } = config.user;
  const isPrivateMarketplace = config.accessControl.marketplace.private === true;
  const isUnauthorizedUser = currentUser && !isUserAuthorized(currentUser);
  const isUnauthorizedOnPrivateMarketplace = isPrivateMarketplace && isUnauthorizedUser;
  const hasUserPendingApprovalError = isErrorUserPendingApproval(userShowError);
  const hasNoViewingRightsUser = currentUser && !hasPermissionToViewData(currentUser);
  const hasNoViewingRightsOnPrivateMarketplace = isPrivateMarketplace && hasNoViewingRightsUser;

  const userTypeRoles = getCurrentUserTypeRoles(config, profileUser);

  const isDataLoaded = isPreview
    ? currentUser != null || userShowError != null
    : hasNoViewingRightsOnPrivateMarketplace
    ? currentUser != null || userShowError != null
    : user != null || userShowError != null;

  const schemaTitleVars = { name: displayName, marketplaceName: config.marketplaceName };
  const schemaTitle = intl.formatMessage({ id: 'ProfilePage.schemaTitle' }, schemaTitleVars);

  if (!isDataLoaded) {
    return null;
  } else if (!isPreview && isNotFoundError(userShowError)) {
    return <NotFoundPage staticContext={props.staticContext} />;
  } else if (!isPreview && (isUnauthorizedOnPrivateMarketplace || hasUserPendingApprovalError)) {
    return (
      <NamedRedirect
        name="NoAccessPage"
        params={{ missingAccessRight: NO_ACCESS_PAGE_USER_PENDING_APPROVAL }}
      />
    );
  } else if (
    (!isPreview && hasNoViewingRightsOnPrivateMarketplace && !isCurrentUser) ||
    isErrorNoViewingPermission(userShowError)
  ) {
    // Someone without viewing rights on a private marketplace is trying to
    // view a profile page that is not their own – redirect to NoAccessPage
    return (
      <NamedRedirect
        name="NoAccessPage"
        params={{ missingAccessRight: NO_ACCESS_PAGE_VIEW_LISTINGS }}
      />
    );
  } else if (!isPreview && isForbiddenError(userShowError)) {
    // This can happen if private marketplace mode is active, but it's not reflected through asset yet.
    return (
      <NamedRedirect
        name="SignupPage"
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  } else if (isPreview && mounted && !isCurrentUser) {
    // Someone is manipulating the URL, redirect to current user's profile page.
    return isCurrentUser === false ? (
      <NamedRedirect name="ProfilePage" params={{ id: currentUser?.id?.uuid }} />
    ) : null;
  } else if ((isPreview || isPrivateMarketplace) && !mounted) {
    // This preview of the profile page is not rendered on server-side
    // and the first pass on client-side should render the same UI.
    return null;
  }

  // This is rendering normal profile page (not preview for pending-approval)
  return (
    <Page
      scrollingDisabled={scrollingDisabled}
      title={schemaTitle}
      schema={{
        '@context': 'http://schema.org',
        '@type': 'ProfilePage',
        mainEntity: {
          '@type': 'Person',
          name: profileUser?.attributes?.profile?.displayName,
        },
        name: schemaTitle,
      }}
    >
      <LayoutSideNavigation
        sideNavClassName={css.aside}
        topbar={<TopbarContainer />}
        sideNav={
          <AsideContent
            user={profileUser}
            showLinkToProfileSettingsPage={mounted && isCurrentUser}
            displayName={isLaundry ? laundryProfile.studioName || displayName : displayName}
          />
        }
        footer={<FooterContainer />}
      >
        <MainContent
          bio={bio}
          displayName={displayName}
          userShowError={userShowError}
          publicData={publicData}
          metadata={metadata}
          userFieldConfig={userFields}
          // No reviews for a laundry - it isn't a transaction party, so it never
          // has any (Jonathan, 2026-09-11: "Hay que quitar la sección de reviews
          // ya que no reviews para laundry").
          hideReviews={hasNoViewingRightsOnPrivateMarketplace || isLaundry}
          intl={intl}
          userTypeRoles={userTypeRoles}
          isLaundry={isLaundry}
          laundryProfile={laundryProfile}
          {...rest}
        />
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const {
    userId,
    userShowError,
    queryListingsError,
    userListingRefs,
    reviews = [],
    queryReviewsError,
  } = state.ProfilePage;
  const userMatches = getMarketplaceEntities(state, [{ type: 'user', id: userId }]);
  const user = userMatches.length === 1 ? userMatches[0] : null;

  // Show currentUser's data if it's not approved yet
  const isCurrentUser = userId?.uuid === currentUser?.id?.uuid;
  const useCurrentUser =
    isCurrentUser && !(isUserAuthorized(currentUser) && hasPermissionToViewData(currentUser));

  return {
    scrollingDisabled: isScrollingDisabled(state),
    currentUser,
    useCurrentUser,
    user,
    userShowError,
    queryListingsError,
    listings: getMarketplaceEntities(state, userListingRefs),
    reviews,
    queryReviewsError,
  };
};

const ProfilePage = compose(connect(mapStateToProps))(ProfilePageComponent);

export default ProfilePage;
