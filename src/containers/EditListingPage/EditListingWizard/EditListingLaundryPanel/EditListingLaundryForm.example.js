/* eslint-disable no-console */
import EditListingLaundryForm from './EditListingLaundryForm';

const laundries = [
  {
    id: 'laundry-1',
    displayName: 'Studio Pigalle',
    publicData: {
      laundryProfile: {
        studioName: 'Studio Pigalle',
        address: '21 Rue Frochot, Paris',
        businessHours: 'Mon–Sat · 11:00–21:00',
      },
      acceptedCategories: ['Eveningwear', 'Sequins', 'Embroidery'],
    },
    turnaroundHours: 48,
  },
  {
    id: 'laundry-2',
    displayName: 'Maison du Marais',
    publicData: {
      laundryProfile: {
        studioName: 'Maison du Marais',
        address: '5 Rue des Rosiers, Paris',
        businessHours: 'Tue–Sun · 10:00–19:00',
      },
      acceptedCategories: ['Denim', 'Cotton', 'Leather goods'],
    },
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
