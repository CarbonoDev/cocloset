import routeConfiguration from './routeConfiguration';
import { COCLOSET_BOOKING_PROCESS_NAME } from '../transactions/transaction';
import { tabsForListingType } from '../containers/EditListingPage/EditListingWizard/EditListingWizard';

// `/l/new` is a bare redirect into the wizard, with the opening tab hardcoded: route config
// has no access to listingTypes, so it cannot ask which tab is first. That was harmless
// while every process opened on DETAILS. cocloset-booking opens on PHOTOS, so the constant
// and the tab array can now disagree - and the failure is quiet, because the wizard
// silently redirects away from a tab that is not yet active and only logs to the console.
//
// This test is the join between the two. It reads the first tab out of the real tab array
// rather than restating 'photos', so reordering the array without updating the route fails
// here instead of costing every owner an extra redirect on every "create listing" click.
const listingTypeConfig = {
  defaultListingFields: {
    location: true,
    price: true,
    availability: true,
    images: true,
    shipping: false,
    pickup: false,
    stock: false,
  },
};

describe('routeConfiguration: /l/new', () => {
  const newListingRoute = routeConfiguration({}).find(route => route.name === 'NewListingPage');

  it('redirects to the first tab of the cocloset-booking wizard', () => {
    // The route's component is a thunk returning a NamedRedirect element, so its params are
    // readable without rendering.
    const redirect = newListingRoute.component();
    const firstTab = tabsForListingType(COCLOSET_BOOKING_PROCESS_NAME, listingTypeConfig)[0];

    expect(redirect.props.params.tab).toEqual(firstTab);
  });

  it('starts a "new" listing rather than resuming a draft', () => {
    const redirect = newListingRoute.component();

    expect(redirect.props.params.type).toEqual('new');
    // The nil UUID placeholder: there is no listing yet, and there must not be until the
    // details tab creates one.
    expect(redirect.props.params.id).toEqual('00000000-0000-0000-0000-000000000000');
  });
});
