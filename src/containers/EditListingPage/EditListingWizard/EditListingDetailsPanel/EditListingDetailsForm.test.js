import React from 'react';
import '@testing-library/jest-dom';

import { pickCategoryFields } from '../../../../util/fieldHelpers';
import { fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingDetailsForm from './EditListingDetailsForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

describe('EditListingDetailsForm', () => {
  it('Check that shipping fees can be given and submit button activates', async () => {
    const user = userEvent.setup();
    const saveActionMsg = 'Save details';

    const selectableListingTypes = [
      {
        listingType: 'sell-bicycles',
        transactionProcessAlias: 'default-purchase/release-1',
        unitType: 'item',
      },
    ];

    const listingFieldsConfig = [
      {
        key: 'clothing',
        scope: 'public',
        listingTypeConfig: {
          limitToListingTypeIds: true,
          listingTypeIds: ['sell-bicycles'],
        },
        schemaType: 'enum',
        enumOptions: [
          { option: 'men', label: 'Men' },
          { option: 'women', label: 'Women' },
          { option: 'kids', label: 'Kids' },
        ],
        filterConfig: {
          showFilter: true,
          label: 'Clothing',
        },
        showConfig: {
          label: 'Clothing',
          isDetail: true,
        },
        saveConfig: {
          label: 'Clothing',
        },
      },
      {
        key: 'amenities',
        scope: 'public',
        listingTypeConfig: {
          limitToListingTypeIds: true,
          listingTypeIds: ['rent-bicycles-daily', 'rent-bicycles-nightly', 'rent-bicycles-hourly'],
        },
        schemaType: 'multi-enum',
        enumOptions: [
          { option: 'towels', label: 'Towels' },
          { option: 'bathroom', label: 'Bathroom' },
          { option: 'swimming_pool', label: 'Swimming pool' },
          { option: 'barbeque', label: 'Barbeque' },
        ],
        filterConfig: {
          showFilter: true,
          label: 'Amenities',
        },
        showConfig: {
          label: 'Amenities',
        },
        saveConfig: {
          label: 'Amenities',
        },
      },
    ];

    render(
      <EditListingDetailsForm
        intl={fakeIntl}
        dispatch={noop}
        onListingTypeChange={noop}
        onSubmit={v => v}
        saveActionMsg={saveActionMsg}
        updated={false}
        updateInProgress={false}
        disabled={false}
        ready={false}
        listingFieldsConfig={listingFieldsConfig}
        categoryPrefix="categoryLevel"
        selectableCategories={[]}
        pickSelectedCategories={values => pickCategoryFields(values, 'categoryLevel', 1, [])}
        selectableListingTypes={selectableListingTypes}
        hasExistingListingType={true}
        initialValues={selectableListingTypes[0]}
        marketplaceCurrency="EUR"
      />
    );

    // Pickup fields
    const title = 'EditListingDetailsForm.title';
    expect(screen.getByText(title)).toBeInTheDocument();

    const description = 'EditListingDetailsForm.description';
    expect(screen.getByText(description)).toBeInTheDocument();

    // Test that save button is disabled at first
    expect(screen.getByRole('button', { name: saveActionMsg })).toBeDisabled();

    // Fill mandatory attributes
    await user.type(screen.getByRole('textbox', { name: title }), 'My Listing');
    await user.type(screen.getByRole('textbox', { name: description }), 'Lorem ipsum');

    // Fill custom listing field
    await user.selectOptions(screen.getByLabelText('Clothing'), 'kids');

    // Test that save button is enabled
    expect(screen.getByRole('button', { name: saveActionMsg })).toBeEnabled();
  });

  // ---------------------------------------------------------------------------
  //   > "brand debe estar en el editListingPage como el primer field despues de categoria y
  //   >  subcategoria"
  //
  // Console orders ALL listing fields together, below the title and description, and cannot say
  // that one of them belongs up with the category - so the exception lives in the form and is
  // asserted here. DOM ORDER is the assertion: "brand is present" would pass no matter where it
  // landed, which is the whole thing being asked for.
  // ---------------------------------------------------------------------------
  describe('field order', () => {
    const listingTypes = [
      {
        listingType: 'sell-bicycles',
        transactionProcessAlias: 'default-purchase/release-1',
        unitType: 'item',
      },
    ];

    const textField = (key, label) => ({
      key,
      scope: 'public',
      listingTypeConfig: { limitToListingTypeIds: true, listingTypeIds: ['sell-bicycles'] },
      schemaType: 'text',
      filterConfig: { showFilter: true, label },
      showConfig: { label, isDetail: true },
      saveConfig: { label },
    });

    // Console hands brand over LAST here, so passing is not an accident of config order.
    const listingFieldsConfig = [textField('material', 'Material'), textField('brand', 'Brand')];

    const renderDetailsForm = () =>
      render(
        <EditListingDetailsForm
          intl={fakeIntl}
          dispatch={noop}
          onListingTypeChange={noop}
          onSubmit={v => v}
          saveActionMsg="Save details"
          updated={false}
          updateInProgress={false}
          disabled={false}
          ready={false}
          listingFieldsConfig={listingFieldsConfig}
          categoryPrefix="categoryLevel"
          selectableCategories={[]}
          pickSelectedCategories={values => pickCategoryFields(values, 'categoryLevel', 1, [])}
          selectableListingTypes={listingTypes}
          hasExistingListingType={true}
          initialValues={listingTypes[0]}
          marketplaceCurrency="EUR"
        />
      );

    const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it('puts brand above the title and the description', () => {
      renderDetailsForm();

      const brand = screen.getByLabelText('Brand');
      const title = screen.getByRole('textbox', { name: 'EditListingDetailsForm.title' });
      const description = screen.getByRole('textbox', {
        name: 'EditListingDetailsForm.description',
      });

      expect(isBefore(brand, title)).toBe(true);
      expect(isBefore(brand, description)).toBe(true);
    });

    // The split must not swallow anything: every other field keeps the order Console gave it,
    // below the description, and no field is rendered twice.
    it('leaves every other field where Console put it', () => {
      renderDetailsForm();

      const description = screen.getByRole('textbox', {
        name: 'EditListingDetailsForm.description',
      });

      expect(screen.getAllByLabelText('Brand')).toHaveLength(1);
      expect(screen.getAllByLabelText('Material')).toHaveLength(1);
      expect(isBefore(description, screen.getByLabelText('Material'))).toBe(true);
    });
  });
});
