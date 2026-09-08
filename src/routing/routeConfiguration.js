import React from 'react';
import loadable from '@loadable/component';

import getPageDataLoadingAPI from '../containers/pageDataLoadingAPI';
import NotFoundPage from '../containers/NotFoundPage/NotFoundPage';
import PreviewResolverPage from '../containers/PreviewResolverPage/PreviewResolverPage';

// routeConfiguration needs to initialize containers first
// Otherwise, components will import form container eventually and
// at that point css bundling / imports will happen in wrong order.
import { NamedRedirect } from '../components';

const pageDataLoadingAPI = getPageDataLoadingAPI();

const AuthenticationPage = loadable(() => import(/* webpackChunkName: "AuthenticationPage" */ '../containers/AuthenticationPage/AuthenticationPage'));
const CheckoutPage = loadable(() => import(/* webpackChunkName: "CheckoutPage" */ '../containers/CheckoutPage/CheckoutPage'));
const CMSPage = loadable(() => import(/* webpackChunkName: "CMSPage" */ '../containers/CMSPage/CMSPage'));
const ContactDetailsPage = loadable(() => import(/* webpackChunkName: "ContactDetailsPage" */ '../containers/ContactDetailsPage/ContactDetailsPage'));
const EditListingPage = loadable(() => import(/* webpackChunkName: "EditListingPage" */ '../containers/EditListingPage/EditListingPage'));
const EmailVerificationPage = loadable(() => import(/* webpackChunkName: "EmailVerificationPage" */ '../containers/EmailVerificationPage/EmailVerificationPage'));
const FavoritesPage = loadable(() => import(/* webpackChunkName: "FavoritesPage" */ '../containers/FavoritesPage/FavoritesPage'));
const InboxPage = loadable(() => import(/* webpackChunkName: "InboxPage" */ '../containers/InboxPage/InboxPage'));
const HandoverPage = loadable(() => import(/* webpackChunkName: "HandoverPage" */ '../containers/HandoverPage/HandoverPage'));
const LaundryOpsPage = loadable(() => import(/* webpackChunkName: "LaundryOpsPage" */ '../containers/LaundryOpsPage/LaundryOpsPage'));
const LaundryProfilePage = loadable(() => import(/* webpackChunkName: "LaundryProfilePage" */ '../containers/LaundryProfilePage/LaundryProfilePage'));
const MakeOfferPage = loadable(() => import(/* webpackChunkName: "MakeOfferPage" */ '../containers/MakeOfferPage/MakeOfferPage'));
const LandingPage = loadable(() => import(/* webpackChunkName: "LandingPage" */ '../containers/LandingPage/LandingPage'));
const ListingPageCoverPhoto = loadable(() => import(/* webpackChunkName: "ListingPageCoverPhoto" */ /* webpackPrefetch: true */ '../containers/ListingPage/ListingPageCoverPhoto'));
const ListingPageCarousel = loadable(() => import(/* webpackChunkName: "ListingPageCarousel" */ /* webpackPrefetch: true */ '../containers/ListingPage/ListingPageCarousel'));
const ManageListingsPage = loadable(() => import(/* webpackChunkName: "ManageListingsPage" */ '../containers/ManageListingsPage/ManageListingsPage'));
const ManageAccountPage = loadable(() => import(/* webpackChunkName: "ManageAccountPage" */ '../containers/ManageAccountPage/ManageAccountPage'));
const PasswordChangePage = loadable(() => import(/* webpackChunkName: "PasswordChangePage" */ '../containers/PasswordChangePage/PasswordChangePage'));
const PasswordRecoveryPage = loadable(() => import(/* webpackChunkName: "PasswordRecoveryPage" */ '../containers/PasswordRecoveryPage/PasswordRecoveryPage'));
const PasswordResetPage = loadable(() => import(/* webpackChunkName: "PasswordResetPage" */ '../containers/PasswordResetPage/PasswordResetPage'));
const PartnerLandingPage = loadable(() => import(/* webpackChunkName: "PartnerLandingPage" */ '../containers/PartnerLandingPage/PartnerLandingPage'));
const PaymentMethodsPage = loadable(() => import(/* webpackChunkName: "PaymentMethodsPage" */ '../containers/PaymentMethodsPage/PaymentMethodsPage'));
const PrivacyPolicyPage = loadable(() => import(/* webpackChunkName: "PrivacyPolicyPage" */ '../containers/PrivacyPolicyPage/PrivacyPolicyPage'));
const ProfilePage = loadable(() => import(/* webpackChunkName: "ProfilePage" */ '../containers/ProfilePage/ProfilePage'));
const ProfileSettingsPage = loadable(() => import(/* webpackChunkName: "ProfileSettingsPage" */ '../containers/ProfileSettingsPage/ProfileSettingsPage'));
const RequestQuotePage = loadable(() => import(/* webpackChunkName: "RequestQuotePage" */ '../containers/RequestQuotePage/RequestQuotePage'));
const SearchPageWithMap = loadable(() => import(/* webpackChunkName: "SearchPageWithMap" */ /* webpackPrefetch: true */  '../containers/SearchPage/SearchPageWithMap'));
const SearchPageWithGrid = loadable(() => import(/* webpackChunkName: "SearchPageWithGrid" */ /* webpackPrefetch: true */  '../containers/SearchPage/SearchPageWithGrid'));
const StripePayoutPage = loadable(() => import(/* webpackChunkName: "StripePayoutPage" */ '../containers/StripePayoutPage/StripePayoutPage'));
const TermsOfServicePage = loadable(() => import(/* webpackChunkName: "TermsOfServicePage" */ '../containers/TermsOfServicePage/TermsOfServicePage'));
const TransactionPage = loadable(() => import(/* webpackChunkName: "TransactionPage" */ '../containers/TransactionPage/TransactionPage'));
const NoAccessPage = loadable(() => import(/* webpackChunkName: "NoAccessPage" */ '../containers/NoAccessPage/NoAccessPage'));

// Styleguide helps you to review current components and develop new ones
const StyleguidePage = loadable(() => import(/* webpackChunkName: "StyleguidePage" */ '../containers/StyleguidePage/StyleguidePage'));

export const ACCOUNT_SETTINGS_PAGES = [
  'ContactDetailsPage',
  'PasswordChangePage',
  'StripePayoutPage',
  'PaymentMethodsPage',
  'ManageAccountPage'
];

export const LAUNDRY_OPS_PAGES = [
  'LaundryProfilePage',
  'LaundryOpsDashboardPage',
  'LaundryOpsOrdersPage',
  'LaundryOpsPickupsPage',
  'LaundryOpsReturnsPage',
  'LaundryOpsCleaningPage',
  'LaundryOpsInventoryPage',
];

// https://en.wikipedia.org/wiki/Universally_unique_identifier#Nil_UUID
const draftId = '00000000-0000-0000-0000-000000000000';
const draftSlug = 'draft';

const RedirectToLandingPage = () => <NamedRedirect name="LandingPage" />;

// NOTE: Most server-side endpoints are prefixed with /api. Requests to those
// endpoints are indended to be handled in the server instead of the browser and
// they will not render the application. So remember to avoid routes starting
// with /api and if you encounter clashing routes see server/index.js if there's
// a conflicting route defined there.

// Our routes are exact by default.
// See behaviour from Routes.js where Route is created.
const routeConfiguration = (layoutConfig, accessControlConfig) => {
  const isSearchPageWithMap = layoutConfig.searchPage?.variantType === 'map';
  const SearchPage = isSearchPageWithMap ? SearchPageWithMap : SearchPageWithGrid;
  const ListingPage = layoutConfig.listingPage?.variantType === 'carousel'
    ? ListingPageCarousel
    : ListingPageCoverPhoto;

  const isPrivateMarketplace = accessControlConfig?.marketplace?.private === true;
  const authForPrivateMarketplace = isPrivateMarketplace ? { auth: true } : {};

  return [
    {
      path: '/',
      name: 'LandingPage',
      component: LandingPage,
      loadData: pageDataLoadingAPI.LandingPage.loadData,
    },
    {
      path: '/p/:pageId',
      name: 'CMSPage',
      component: CMSPage,
      loadData: pageDataLoadingAPI.CMSPage.loadData,
    },
    // NOTE: when the private marketplace feature is enabled, the '/s' route is disallowed by the robots.txt resource.
    // If you add new routes that start with '/s*' (e.g. /support), you should add them to the robotsPrivateMarketplace.txt file.
    {
      path: '/s',
      name: 'SearchPage',
      ...authForPrivateMarketplace,
      component: SearchPage,
      loadData: pageDataLoadingAPI.SearchPage.loadData,
      prioritizeLibraryLoading: {
        map: isSearchPageWithMap,
      },
    },
    {
      path: '/s/:listingType',
      name: 'SearchPageWithListingType',
      ...authForPrivateMarketplace,
      component: SearchPage,
      loadData: pageDataLoadingAPI.SearchPage.loadData,
      prioritizeLibraryLoading: {
        map: isSearchPageWithMap,
      },
    },
    {
      path: '/l',
      name: 'ListingBasePage',
      component: RedirectToLandingPage,
    },
    {
      path: '/l/:slug/:id',
      name: 'ListingPage',
      ...authForPrivateMarketplace,
      component: ListingPage,
      loadData: pageDataLoadingAPI.ListingPage.loadData,
      prioritizeLibraryLoading: {
        map: true,
      },
    },
    {
      path: '/l/:slug/:id/make-offer',
      name: 'MakeOfferPage',
      auth: true,
      component: MakeOfferPage,
      loadData: pageDataLoadingAPI.MakeOfferPage.loadData,
    },
    {
      path: '/l/:slug/:id/request-quote',
      name: 'RequestQuotePage',
      auth: true,
      component: RequestQuotePage,
      extraProps: { mode: 'request-quote' },
      loadData: pageDataLoadingAPI.RequestQuotePage.loadData,
    },
    {
      path: '/l/:slug/:id/checkout',
      name: 'CheckoutPage',
      auth: true,
      component: CheckoutPage,
      setInitialValues: pageDataLoadingAPI.CheckoutPage.setInitialValues,
      prioritizeLibraryLoading: {
        stripe: true,
      },
    },
    {
      path: '/l/:slug/:id/:variant',
      name: 'ListingPageVariant',
      auth: true,
      authPage: 'LoginPage',
      component: ListingPage,
      loadData: pageDataLoadingAPI.ListingPage.loadData,
      prioritizeLibraryLoading: {
        map: true,
      },
    },
    {
      path: '/l/new',
      name: 'NewListingPage',
      auth: true,
      // The first tab of the wizard. Cocloset runs a single listing type
      // (garment-rental -> cocloset-booking), whose tab order starts with PHOTOS
      // rather than DETAILS - see `tabsForListingType` in EditListingWizard.js.
      // Route config has no access to listingTypes, so this is a constant; the
      // wizard corrects a mismatch either way (an inactive tab redirects to the
      // nearest active one), but pointing it at the real first tab avoids a
      // needless redirect and a console message on every "create listing" click.
      component: () => (
        <NamedRedirect
          name="EditListingPage"
          params={{ slug: draftSlug, id: draftId, type: 'new', tab: 'photos' }}
        />
      ),
    },
    {
      path: '/l/:slug/:id/:type/:tab',
      name: 'EditListingPage',
      auth: true,
      component: EditListingPage,
      loadData: pageDataLoadingAPI.EditListingPage.loadData,
      prioritizeLibraryLoading: {
        stripe: true,
      },
    },
    {
      path: '/l/:slug/:id/:type/:tab/:returnURLType',
      name: 'EditListingStripeOnboardingPage',
      auth: true,
      component: EditListingPage,
      loadData: pageDataLoadingAPI.EditListingPage.loadData,
      prioritizeLibraryLoading: {
        stripe: true,
      },
    },

    // Canonical path should be after the `/l/new` path since they
    // conflict and `new` is not a valid listing UUID.
    {
      path: '/l/:id',
      name: 'ListingPageCanonical',
      ...authForPrivateMarketplace,
      component: ListingPage,
      loadData: pageDataLoadingAPI.ListingPage.loadData,
      prioritizeLibraryLoading: {
        map: true,
      },
    },
    {
      path: '/u',
      name: 'ProfileBasePage',
      component: RedirectToLandingPage,
    },
    {
      path: '/u/:id',
      name: 'ProfilePage',
      ...authForPrivateMarketplace,
      component: ProfilePage,
      loadData: pageDataLoadingAPI.ProfilePage.loadData,
    },
    {
      path: '/u/:id/:variant',
      name: 'ProfilePageVariant',
      auth: true,
      component: ProfilePage,
      loadData: pageDataLoadingAPI.ProfilePage.loadData,
    },
    {
      path: '/profile-settings',
      name: 'ProfileSettingsPage',
      auth: true,
      authPage: 'LoginPage',
      component: ProfileSettingsPage,
    },

    // Note: authenticating with IdP (e.g. Facebook) expects that /login path exists
    // so that in the error case users can be redirected back to the LoginPage
    // In case you change this, remember to update the route in server/api/auth/loginWithIdp.js
    {
      path: '/login',
      name: 'LoginPage',
      component: AuthenticationPage,
      extraProps: { tab: 'login' },
    },
    {
      path: '/signup',
      name: 'SignupPage',
      component: AuthenticationPage,
      extraProps: { tab: 'signup' },
      loadData: pageDataLoadingAPI.AuthenticationPage.loadData,
    },
    {
      path: '/signup/:userType',
      name: 'SignupForUserTypePage',
      component: AuthenticationPage,
      extraProps: { tab: 'signup' },
      loadData: pageDataLoadingAPI.AuthenticationPage.loadData,
    },
    {
      path: '/confirm',
      name: 'ConfirmPage',
      component: AuthenticationPage,
      extraProps: { tab: 'confirm' },
      loadData: pageDataLoadingAPI.AuthenticationPage.loadData,
    },
    {
      path: '/recover-password',
      name: 'PasswordRecoveryPage',
      component: PasswordRecoveryPage,
    },
    {
      path: '/inbox',
      name: 'InboxBasePage',
      auth: true,
      authPage: 'LoginPage',
      component: () => <NamedRedirect name="InboxPage" params={{ tab: 'sales' }} />,
    },
    {
      path: '/inbox/:tab',
      name: 'InboxPage',
      auth: true,
      authPage: 'LoginPage',
      component: InboxPage,
      loadData: pageDataLoadingAPI.InboxPage.loadData,
    },
    {
      // Saved garments. `auth: true` because the list is a fact about the signed-in user and
      // nothing else - there is no anonymous version of this page to render. The heart on a
      // listing sends a signed-out visitor to log in for the same reason.
      path: '/favorites',
      name: 'FavoritesPage',
      auth: true,
      authPage: 'LoginPage',
      component: FavoritesPage,
      loadData: pageDataLoadingAPI.FavoritesPage.loadData,
    },
    {
      path: '/order/:id',
      name: 'OrderDetailsPage',
      auth: true,
      authPage: 'LoginPage',
      component: TransactionPage,
      extraProps: { transactionRole: 'customer' },
      loadData: (params, ...rest) =>
        pageDataLoadingAPI.TransactionPage.loadData({ ...params, transactionRole: 'customer' }, ...rest),
      setInitialValues: pageDataLoadingAPI.TransactionPage.setInitialValues,
    },
    {
      path: '/order/:id/details',
      name: 'OrderDetailsPageRedirect',
      auth: true,
      authPage: 'LoginPage',
      component: props => <NamedRedirect name="OrderDetailsPage" params={{ id: props.params?.id }} />,
    },
    {
      path: '/sale/:id',
      name: 'SaleDetailsPage',
      auth: true,
      authPage: 'LoginPage',
      component: TransactionPage,
      extraProps: { transactionRole: 'provider' },
      loadData: pageDataLoadingAPI.TransactionPage.loadData,
    },
    {
      path: '/sale/:id/details',
      name: 'SaleDetailsPageRedirect',
      auth: true,
      authPage: 'LoginPage',
      component: props => <NamedRedirect name="SaleDetailsPage" params={{ id: props.params?.id }} />,
    },
    {
      path: '/listings',
      name: 'ManageListingsPage',
      auth: true,
      authPage: 'LoginPage',
      component: ManageListingsPage,
      loadData: pageDataLoadingAPI.ManageListingsPage.loadData,
    },
    {
      path: '/account',
      name: 'AccountSettingsPage',
      auth: true,
      authPage: 'LoginPage',
      component: () => <NamedRedirect name="ContactDetailsPage" />,
    },
    {
      path: '/account/contact-details',
      name: 'ContactDetailsPage',
      auth: true,
      authPage: 'LoginPage',
      component: ContactDetailsPage,
      loadData: pageDataLoadingAPI.ContactDetailsPage.loadData,
    },
    {
      path: '/account/change-password',
      name: 'PasswordChangePage',
      auth: true,
      authPage: 'LoginPage',
      component: PasswordChangePage,
    },
    {
      path: '/account/payments',
      name: 'StripePayoutPage',
      auth: true,
      authPage: 'LoginPage',
      component: StripePayoutPage,
      loadData: pageDataLoadingAPI.StripePayoutPage.loadData,
      prioritizeLibraryLoading: {
        stripe: true,
      },
    },
    {
      path: '/account/payments/:returnURLType',
      name: 'StripePayoutOnboardingPage',
      auth: true,
      authPage: 'LoginPage',
      component: StripePayoutPage,
      loadData: pageDataLoadingAPI.StripePayoutPage.loadData,
      prioritizeLibraryLoading: {
        stripe: true,
      },
    },
    {
      path: '/account/payment-methods',
      name: 'PaymentMethodsPage',
      auth: true,
      authPage: 'LoginPage',
      component: PaymentMethodsPage,
      loadData: pageDataLoadingAPI.PaymentMethodsPage.loadData,
      prioritizeLibraryLoading: {
        stripe: true,
      },
    },
    {
      path: '/account/manage',
      name: 'ManageAccountPage',
      auth: true,
      authPage: 'LoginPage',
      component: ManageAccountPage,
    },
    {
      // Public, unauthenticated marketing + application page for prospective
      // laundry partners. Copy comes from the optional Console page
      // `laundry-partners`; the application form is code. Not behind
      // authForPrivateMarketplace on purpose: the whole point is that visitors
      // without an account can find it.
      path: '/become-a-partner',
      name: 'PartnerLandingPage',
      component: PartnerLandingPage,
      loadData: pageDataLoadingAPI.PartnerLandingPage.loadData,
    },
    {
      // Where a scanned handover QR lands. The path is half of a contract - the other half
      // is HANDOVER_PATH in server/api-util/handoverQr.js, which builds the URL that gets
      // encoded into the image - so changing it here alone produces a code that scans to a
      // 404. handoverQrUrlAgreement.test.js checks the two against each other.
      //
      // `auth: true` because the page has to know who is reading before it can decide what
      // to show them; an anonymous scan is sent to log in and comes back here. Which of the
      // three roles the reader is, and therefore whether they get an action at all, is
      // decided by GET /api/handover-status - not here, and not in the browser.
      path: '/handover/:id',
      name: 'HandoverPage',
      auth: true,
      authPage: 'LoginPage',
      component: HandoverPage,
      loadData: pageDataLoadingAPI.HandoverPage.loadData,
    },
    {
      // Laundry-only studio profile settings. Gated inside LaundryProfilePage
      // itself (renders NotFoundPage for non-laundry users) since permission
      // here depends on user metadata, not just authentication.
      path: '/laundry-profile',
      name: 'LaundryProfilePage',
      auth: true,
      authPage: 'LoginPage',
      component: LaundryProfilePage,
    },
    // Laundry ops dashboard (mockups 04-09.jpg). One container, six routes:
    // the `tab` extraProp selects which screen it renders, and they all share
    // a single loadData because they render one payload from
    // GET /api/laundry-orders. Gated inside LaundryOpsPage itself (renders
    // NotFoundPage for non-laundry users), same as LaundryProfilePage above,
    // since permission depends on user metadata rather than authentication.
    // "Settings" in the ops sidebar links to LaundryProfilePage rather than
    // duplicating it here.
    ...['dashboard', 'orders', 'pickups', 'returns', 'cleaning', 'inventory'].map(tab => ({
      path: `/laundry/${tab}`,
      name: `LaundryOps${tab.charAt(0).toUpperCase()}${tab.slice(1)}Page`,
      auth: true,
      authPage: 'LoginPage',
      component: LaundryOpsPage,
      extraProps: { tab },
      loadData: pageDataLoadingAPI.LaundryOpsPage.loadData,
    })),
    {
      path: '/terms-of-service',
      name: 'TermsOfServicePage',
      component: TermsOfServicePage,
      loadData: pageDataLoadingAPI.TermsOfServicePage.loadData,
    },
    {
      path: '/privacy-policy',
      name: 'PrivacyPolicyPage',
      component: PrivacyPolicyPage,
      loadData: pageDataLoadingAPI.PrivacyPolicyPage.loadData,
    },
    {
      path: '/styleguide',
      name: 'Styleguide',
      ...authForPrivateMarketplace,
      component: StyleguidePage,
    },
    {
      path: '/styleguide/g/:group',
      name: 'StyleguideGroup',
      ...authForPrivateMarketplace,
      component: StyleguidePage,
    },
    {
      path: '/styleguide/c/:component',
      name: 'StyleguideComponent',
      ...authForPrivateMarketplace,
      component: StyleguidePage,
    },
    {
      path: '/styleguide/c/:component/:example',
      name: 'StyleguideComponentExample',
      ...authForPrivateMarketplace,
      component: StyleguidePage,
    },
    {
      path: '/styleguide/c/:component/:example/raw',
      name: 'StyleguideComponentExampleRaw',
      ...authForPrivateMarketplace,
      component: StyleguidePage,
      extraProps: { raw: true },
    },
    {
      path: '/no-:missingAccessRight',
      name: 'NoAccessPage',
      component: NoAccessPage,
    },
    {
      path: '/notfound',
      name: 'NotFoundPage',
      component: props => <NotFoundPage {...props} />,
    },

    // Do not change this path!
    //
    // The API expects that the application implements /reset-password endpoint
    {
      path: '/reset-password',
      name: 'PasswordResetPage',
      component: PasswordResetPage ,
    },

    // Do not change this path!
    //
    // The API expects that the application implements /verify-email endpoint
    {
      path: '/verify-email',
      name: 'EmailVerificationPage',
      auth: true,
      authPage: 'LoginPage',
      component: EmailVerificationPage,
      loadData: pageDataLoadingAPI.EmailVerificationPage.loadData,
    },
    // Do not change this path!
    //
    // The API expects that the application implements /preview endpoint
    {
      path: '/preview',
      name: 'PreviewResolverPage',
      component: PreviewResolverPage ,
    },
  ];
};

export default routeConfiguration;
