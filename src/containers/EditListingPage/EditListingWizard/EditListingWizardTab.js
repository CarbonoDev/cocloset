import React from 'react';
import { Helmet } from 'react-helmet-async';

// Import configs and util modules
import {
  LISTING_PAGE_PARAM_TYPE_DRAFT,
  LISTING_PAGE_PARAM_TYPE_NEW,
} from '../../../util/urlHelpers';
import { ensureListing } from '../../../util/data';
import { createResourceLocatorString } from '../../../util/routes';

// Import modules from this directory
import EditListingAvailabilityPanel from './EditListingAvailabilityPanel/EditListingAvailabilityPanel';
import EditListingDetailsPanel from './EditListingDetailsPanel/EditListingDetailsPanel';
import EditListingDeliveryPanel from './EditListingDeliveryPanel/EditListingDeliveryPanel';
import EditListingFilesPanel from './EditListingFilesPanel/EditListingFilesPanel';
import EditListingLaundryPanel from './EditListingLaundryPanel/EditListingLaundryPanel';
import EditListingLocationPanel from './EditListingLocationPanel/EditListingLocationPanel';
import EditListingPhotosPanel from './EditListingPhotosPanel/EditListingPhotosPanel';
import EditListingPricingPanel from './EditListingPricingPanel/EditListingPricingPanel';
import EditListingPricingAndStockPanel from './EditListingPricingAndStockPanel/EditListingPricingAndStockPanel';
import EditListingStylePanel from './EditListingStylePanel/EditListingStylePanel';

import css from './EditListingWizardTab.module.css';

export const DETAILS = 'details';
export const PRICING = 'pricing';
export const PRICING_AND_STOCK = 'pricing-and-stock';
export const DELIVERY = 'delivery';
export const FILES = 'files';
export const LOCATION = 'location';
export const LAUNDRY = 'laundry';
export const AVAILABILITY = 'availability';
export const PHOTOS = 'photos';
export const STYLE = 'style';

// EditListingWizardTab component supports these tabs
export const SUPPORTED_TABS = [
  DETAILS,
  PRICING,
  PRICING_AND_STOCK,
  DELIVERY,
  FILES,
  LOCATION,
  LAUNDRY,
  AVAILABILITY,
  PHOTOS,
  STYLE,
];

const pathParamsToNextTab = (params, tab, marketplaceTabs) => {
  const nextTabIndex = marketplaceTabs.findIndex(s => s === tab) + 1;
  const nextTab =
    nextTabIndex < marketplaceTabs.length
      ? marketplaceTabs[nextTabIndex]
      : marketplaceTabs[marketplaceTabs.length - 1];
  return { ...params, tab: nextTab };
};

// Advance to the next tab without having saved anything.
//
// Used only by the tabs that precede DETAILS in the cocloset-booking flow: they cannot
// create the draft (`ownListings.createDraft` requires `title` and `listingType`, which
// only DETAILS collects), so submitting them while no listing exists writes nothing at
// all. The path params are passed through untouched, which is the point: the URL must
// stay `new` until a draft really exists, so that `redirectAfterDraftUpdate` below can
// still perform the new -> draft swap on the first real save.
const redirectToNextTabWithoutSaving = (params, tab, marketplaceTabs, history, routes) => {
  const nextPathParams = pathParamsToNextTab(params, tab, marketplaceTabs);
  const to = createResourceLocatorString('EditListingPage', routes, nextPathParams, {});
  history.push(to);
};

// When user has update draft listing, he should be redirected to next EditListingWizardTab
const redirectAfterDraftUpdate = (listingId, params, tab, marketplaceTabs, history, routes) => {
  const listingUUID = listingId.uuid;
  const currentPathParams = {
    ...params,
    type: LISTING_PAGE_PARAM_TYPE_DRAFT,
    id: listingUUID,
  };

  // Replace current "new" path to "draft" path.
  // Browser's back button should lead to editing current draft instead of creating a new one.
  if (params.type === LISTING_PAGE_PARAM_TYPE_NEW) {
    const draftURI = createResourceLocatorString('EditListingPage', routes, currentPathParams, {});
    history.replace(draftURI);
  }

  // Redirect to next tab
  const nextPathParams = pathParamsToNextTab(currentPathParams, tab, marketplaceTabs);
  const to = createResourceLocatorString('EditListingPage', routes, nextPathParams, {});
  history.push(to);
};

/**
 * A single tab on the EditListingWizard.
 *
 * @component
 * @param {Object} props
 * @returns {JSX.Element} EditListingWizardTab component
 */
const EditListingWizardTab = props => {
  const {
    tab,
    marketplaceTabs,
    params,
    locationSearch,
    errors,
    fetchInProgress,
    newListingPublished,
    handleCreateFlowTabScrolling,
    handlePublishListing,
    history,
    images,
    listing,
    weeklyExceptionQueries,
    monthlyExceptionQueries,
    allExceptions,
    onFetchExceptions,
    onAddAvailabilityException,
    onDeleteAvailabilityException,
    onUpdateListing,
    onCreateListingDraft,
    onImageUpload,
    onManageDisableScrolling,
    onListingTypeChange,
    onRemoveImage,
    updatedTab,
    updateInProgress,
    tabSubmitButtonText,
    config,
    routeConfiguration,
    titleId,
    intl,
    fileUploads,
    fileUploadsDisabled,
    onUploadFile,
    onClearUploadedFiles,
    onDownloadFile,
    hasPendingFileUploads,
    allFilesUploadedAndVerified,
    filesRequired,
    captureOwnerAddress,
    previewListingLink,
  } = props;

  const { type } = params;
  const isNewURI = type === LISTING_PAGE_PARAM_TYPE_NEW;
  const isDraftURI = type === LISTING_PAGE_PARAM_TYPE_DRAFT;
  const isNewListingFlow = isNewURI || isDraftURI;

  const currentListing = ensureListing(listing);

  // New listing flow has automatic redirects to new tab on the wizard
  // and the last panel calls publishListing API endpoint.
  const automaticRedirectsForNewListingFlow = (tab, listingId) => {
    if (tab !== marketplaceTabs[marketplaceTabs.length - 1]) {
      // Create listing flow: smooth scrolling polyfill to scroll to correct tab
      handleCreateFlowTabScrolling(false);

      // After successful saving of draft data, user should be redirected to next tab
      redirectAfterDraftUpdate(
        listingId,
        params,
        tab,
        marketplaceTabs,
        history,
        routeConfiguration
      );
    } else {
      handlePublishListing(listingId);
    }
  };

  const onCompleteEditListingWizardTab = (tab, updateValues) => {
    // Which tab creates the draft listing.
    //
    // It used to be "whichever tab is submitted while the URL says `new`", i.e. always the
    // first tab in the array. cocloset-booking opens on PHOTOS, and per the Marketplace
    // API reference `title` and `listingType` are REQUIRED to create a draft - neither of
    // which the photos panel has. So creation is pinned to DETAILS wherever it sits in the
    // array instead. Every other process still has DETAILS first, so for them this is a
    // no-op.
    const createsTheDraft = tab === DETAILS;

    if (isNewURI && !createsTheDraft) {
      // Nothing to save: there is no listing to update and this tab cannot create one.
      // The uploaded image ids simply stay in Redux (EditListingPage.uploadedImages is
      // keyed by a client-side temp id and is not cleared on listing change) and are
      // handed to createDraft when DETAILS runs.
      //
      // A page refresh at this point does lose those ids - they were never persisted
      // anywhere else - but it does not strand the owner: PHOTOS then reports itself
      // incomplete, and EditListingWizard's own guard redirects from the locked tab back
      // to the first one.
      handleCreateFlowTabScrolling(false);
      redirectToNextTabWithoutSaving(params, tab, marketplaceTabs, history, routeConfiguration);
      return Promise.resolve();
    }

    const onUpdateListingOrCreateListingDraft = isNewURI
      ? (tab, values) => onCreateListingDraft(values, config)
      : (tab, values) => onUpdateListing(tab, values, config);

    // Hand the images collected on the earlier PHOTOS tab to the create call. The duck
    // runs `imageIds()` on the create path exactly as it does on update, and createDraft
    // accepts `images`. Only added when there is something to add, so a details-first
    // process sends precisely what it sent before.
    const collectedImages = images || [];
    const imagesMaybe =
      collectedImages.length > 0 && typeof updateValues.images === 'undefined'
        ? { images: collectedImages }
        : {};

    const updateListingValues = isNewURI
      ? { ...updateValues, ...imagesMaybe }
      : { ...updateValues, id: currentListing.id };

    return onUpdateListingOrCreateListingDraft(tab, updateListingValues)
      .then(r => {
        // In Availability tab, the submitted data (plan) is inside a modal
        // We don't redirect provider immediately after plan is set
        if (isNewListingFlow && tab !== AVAILABILITY) {
          const listingId = r.data.data.id;
          automaticRedirectsForNewListingFlow(tab, listingId);
        }
      })
      .catch(e => {
        // No need for extra actions
      });
  };

  const isLastTab = tab => tab === marketplaceTabs[marketplaceTabs.length - 1];
  const filesTabParams = { ...params, tab: FILES };

  const panelProps = tab => {
    return {
      className: css.panel,
      errors,
      listing,
      panelUpdated: updatedTab === tab,
      params,
      locationSearch,
      updateInProgress,
      // newListingPublished and fetchInProgress are flags for the last wizard tab
      ready: newListingPublished,
      // Files need to be uploaded and verified when publishing the listing
      // (if specified in the listing type config)
      disabled:
        fetchInProgress ||
        (isLastTab(tab) && filesRequired && (fileUploadsDisabled || !allFilesUploadedAndVerified)),
      submitButtonText: tabSubmitButtonText,
      // THE PREVIEW, WHERE THE READER IS ALREADY LOOKING.
      //
      //   > "El button de preview listing debe estar al lado de next como un
      //   >  botón secundario, donde esta pierde visibilidad" (Jonathan, 2026-09-03)
      //
      // It used to be a quiet underlined link above the whole wizard - rail and
      // panel both - which is nowhere near the place an owner's attention is at
      // the moment they might want it. Passing it down means the FORM decides
      // where it goes, so it lands in the same footer row as the submit button
      // rather than approximating that position from outside the form.
      //
      // A node rather than a flag: the wizard already has the listing and the
      // route configuration needed to build the href, and a form has no business
      // knowing how a listing URL is assembled.
      previewListingLink,
      listingTypes: config.listing.listingTypes,
      onManageDisableScrolling,
      onSubmit: values => {
        return onCompleteEditListingWizardTab(tab, values);
      },
      intl,
      updatePageTitle: ({ panelHeading }) => (
        <Helmet>
          <title>{intl.formatMessage({ id: titleId }, { panelHeading })}</title>
        </Helmet>
      ),
    };
  };

  // TODO: add missing cases for supported tabs
  switch (tab) {
    case DETAILS: {
      return (
        <EditListingDetailsPanel
          {...panelProps(DETAILS)}
          onListingTypeChange={onListingTypeChange}
          captureOwnerAddress={captureOwnerAddress}
          config={config}
        />
      );
    }
    case PRICING_AND_STOCK: {
      return (
        <EditListingPricingAndStockPanel
          {...panelProps(PRICING_AND_STOCK)}
          marketplaceCurrency={config.currency}
          listingMinimumPriceSubUnits={config.listingMinimumPriceSubUnits}
        />
      );
    }
    case PRICING: {
      return (
        <EditListingPricingPanel
          {...panelProps(PRICING)}
          marketplaceCurrency={config.currency}
          listingMinimumPriceSubUnits={config.listingMinimumPriceSubUnits}
        />
      );
    }
    case DELIVERY: {
      return (
        <EditListingDeliveryPanel {...panelProps(DELIVERY)} marketplaceCurrency={config.currency} />
      );
    }
    case FILES: {
      return (
        <EditListingFilesPanel
          {...panelProps(FILES)}
          onUploadFile={onUploadFile}
          onClearUploadedFiles={onClearUploadedFiles}
          onDownloadFile={onDownloadFile}
          fileUploads={fileUploads}
          fileUploadsDisabled={fileUploadsDisabled}
          hasPendingFileUploads={hasPendingFileUploads}
        />
      );
    }
    case LOCATION: {
      return <EditListingLocationPanel {...panelProps(LOCATION)} />;
    }
    case LAUNDRY: {
      // The file props are here for the same reason PHOTOS and STYLE get them: this
      // panel is the LAST one of the cocloset-booking new-listing flow, so it is where
      // the "files still being verified" explanation for a disabled publish button has
      // to render. See Note 4 on `tabsForListingType`.
      return (
        <EditListingLaundryPanel
          {...panelProps(LAUNDRY)}
          allFilesUploadedAndVerified={allFilesUploadedAndVerified}
          filesTabParams={filesTabParams}
          filesRequired={filesRequired}
        />
      );
    }
    case AVAILABILITY: {
      return (
        <EditListingAvailabilityPanel
          allExceptions={allExceptions}
          weeklyExceptionQueries={weeklyExceptionQueries}
          monthlyExceptionQueries={monthlyExceptionQueries}
          onFetchExceptions={onFetchExceptions}
          onAddAvailabilityException={onAddAvailabilityException}
          onDeleteAvailabilityException={onDeleteAvailabilityException}
          onNextTab={() =>
            redirectAfterDraftUpdate(
              listing.id,
              params,
              tab,
              marketplaceTabs,
              history,
              routeConfiguration
            )
          }
          config={config}
          history={history}
          routeConfiguration={routeConfiguration}
          {...panelProps(AVAILABILITY)}
        />
      );
    }
    case PHOTOS: {
      return (
        <EditListingPhotosPanel
          {...panelProps(PHOTOS)}
          listingImageConfig={config.layout.listingImage}
          images={images}
          onImageUpload={onImageUpload}
          onRemoveImage={onRemoveImage}
          allFilesUploadedAndVerified={allFilesUploadedAndVerified}
          filesTabParams={filesTabParams}
          filesRequired={filesRequired}
        />
      );
    }
    case STYLE: {
      return (
        <EditListingStylePanel
          {...panelProps(STYLE)}
          listingImageConfig={config.layout.listingImage}
          images={images}
          allFilesUploadedAndVerified={allFilesUploadedAndVerified}
          filesTabParams={filesTabParams}
          filesRequired={filesRequired}
        />
      );
    }
    default:
      return null;
  }
};

export default EditListingWizardTab;
