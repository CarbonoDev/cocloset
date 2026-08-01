/* eslint-disable no-console */
import EditListingLaundryForm from './EditListingLaundryForm';

// Flat, allowlisted record shape returned by /api/laundries - see
// server/api-util/laundryDirectory.js.
const laundries = [
  {
    id: 'laundry-1',
    displayName: 'Studio Pigalle',
    studioName: 'Studio Pigalle',
    address: '21 Rue Frochot, Paris',
    origin: { lat: 48.882, lng: 2.338 },
    businessHours: 'Mon–Sat · 11:00–21:00',
    acceptedCategories: ['Eveningwear', 'Sequins', 'Embroidery'],
    turnaroundHours: 48,
  },
  {
    id: 'laundry-2',
    displayName: 'Maison du Marais',
    studioName: 'Maison du Marais',
    address: '5 Rue des Rosiers, Paris',
    origin: { lat: 48.857, lng: 2.359 },
    businessHours: 'Tue–Sun · 10:00–19:00',
    acceptedCategories: ['Denim', 'Cotton', 'Leather goods'],
    turnaroundHours: 36,
  },
];

export const Empty = {
  component: EditListingLaundryForm,
  props: {
    onSubmit: values => {
      console.log('Submit EditListingLaundryForm with (unformatted) values:', values);
    },
    saveActionMsg: 'Save laundry assignment',
    updated: false,
    updateInProgress: false,
    disabled: false,
    ready: false,
    laundries,
    fetchLaundriesInProgress: false,
  },
  group: 'page:EditListingPage',
};
