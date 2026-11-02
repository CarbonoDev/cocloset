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

  // ---------------------------------------------------------------------------
  //   > "Podemos usar brand como un autocomplete de todas las brands que existen"
  //
  // Brand is NOT a Console listing field - it was removed so flex-cli could own the pub_brand
  // search schema - so nothing renders it but this bespoke input. Which also means Console
  // could never have provided it: Console draws a plain text box, and a plain text box is not
  // an autocomplete.
  // ---------------------------------------------------------------------------
  describe('the brand autocomplete', () => {
    const listingTypes = [
      {
        listingType: 'sell-bicycles',
        transactionProcessAlias: 'default-purchase/release-1',
        unitType: 'item',
      },
    ];

    const brandOptions = [{ brand: 'Reformation', count: 3 }, { brand: 'ZARA', count: 1 }];

    const renderWithBrand = (props = {}) =>
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
          listingFieldsConfig={[]}
          brandOptions={brandOptions}
          categoryPrefix="categoryLevel"
          selectableCategories={[]}
          pickSelectedCategories={values => pickCategoryFields(values, 'categoryLevel', 1, [])}
          selectableListingTypes={listingTypes}
          hasExistingListingType={true}
          initialValues={listingTypes[0]}
          marketplaceCurrency="EUR"
          {...props}
        />
      );

    it('renders an input for a field Console does not have', () => {
      renderWithBrand();

      expect(screen.getByLabelText('EditListingDetailsForm.brand')).toBeInTheDocument();
    });

    // The suggestions are a shortcut to a brand that exists, never a restriction to one: a
    // garment whose brand nobody has listed yet still has to be listable.
    it('suggests the brands that exist without limiting the input to them', () => {
      renderWithBrand();

      const input = screen.getByLabelText('EditListingDetailsForm.brand');
      const list = document.getElementById(input.getAttribute('list'));

      expect(input.tagName).toBe('INPUT');
      expect([...list.querySelectorAll('option')].map(o => o.value)).toEqual([
        'Reformation',
        'ZARA',
      ]);
    });

    it('still renders the input when no brands could be fetched', () => {
      renderWithBrand({ brandOptions: [] });

      expect(screen.getByLabelText('EditListingDetailsForm.brand')).toBeInTheDocument();
    });

    // Hosted wins, the same rule as listingFieldSearchConfig in util/listingFieldSearch.js.
    // Without this an operator adding brand back in Console would get two brand inputs.
    it('steps aside when Console does have a brand field', () => {
      const hostedBrand = {
        key: 'brand',
        scope: 'public',
        schemaType: 'text',
        listingTypeConfig: { limitToListingTypeIds: true, listingTypeIds: ['sell-bicycles'] },
        filterConfig: { showFilter: true, label: 'Brand' },
        showConfig: { label: 'Brand', isDetail: true },
        saveConfig: { label: 'Brand' },
      };

      renderWithBrand({ listingFieldsConfig: [hostedBrand] });

      expect(screen.queryByLabelText('EditListingDetailsForm.brand')).not.toBeInTheDocument();
      expect(screen.getAllByLabelText('Brand')).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  //   > "hay que agregar una sección 'Special Care' con un conjunto de check boxes, las
  //   >  opciones son: Embellishments (sequins, beadwork, etc.), Leather/Suede Trim, Pressed
  //   >  Pleats, High Value Item (Over $1K), Note to Cleaner: ___"
  //
  // Bespoke rather than a Console field, because the data has to reach the owner and the studio
  // and nobody else - a visibility Console cannot express. See util/specialCare.js.
  // ---------------------------------------------------------------------------
  describe('special care', () => {
    const listingTypes = [
      {
        listingType: 'sell-bicycles',
        transactionProcessAlias: 'default-purchase/release-1',
        unitType: 'item',
      },
    ];

    const renderSpecialCare = (props = {}) =>
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
          listingFieldsConfig={[]}
          categoryPrefix="categoryLevel"
          selectableCategories={[]}
          pickSelectedCategories={values => pickCategoryFields(values, 'categoryLevel', 1, [])}
          selectableListingTypes={listingTypes}
          hasExistingListingType={true}
          initialValues={listingTypes[0]}
          marketplaceCurrency="EUR"
          {...props}
        />
      );

    const OPTIONS = ['embellishments', 'leatherSuedeTrim', 'pressedPleats', 'highValue'];

    it('offers the four options the client listed', () => {
      renderSpecialCare();

      OPTIONS.forEach(option => {
        expect(
          screen.getByLabelText(`EditListingDetailsForm.specialCare.${option}`)
        ).toBeInTheDocument();
      });
    });

    // A separate request asked for a standalone "High Value item" checkbox. Two controls
    // meaning the same thing can disagree, and nothing downstream could say which was right -
    // so there is exactly one, and it is this one.
    it('has exactly one high-value checkbox', () => {
      renderSpecialCare();

      expect(screen.getAllByLabelText('EditListingDetailsForm.specialCare.highValue')).toHaveLength(
        1
      );
    });

    it('offers the free-text note', () => {
      renderSpecialCare();

      expect(screen.getByLabelText('EditListingDetailsForm.specialCare.note')).toBeInTheDocument();
    });

    it('shows what the garment already carries', () => {
      renderSpecialCare({
        initialValues: {
          ...listingTypes[0],
          specialCareFlags: ['highValue', 'pressedPleats'],
          specialCareNote: 'Loose hem',
        },
      });

      expect(screen.getByLabelText('EditListingDetailsForm.specialCare.highValue')).toBeChecked();
      expect(
        screen.getByLabelText('EditListingDetailsForm.specialCare.pressedPleats')
      ).toBeChecked();
      expect(
        screen.getByLabelText('EditListingDetailsForm.specialCare.embellishments')
      ).not.toBeChecked();
      expect(screen.getByLabelText('EditListingDetailsForm.specialCare.note')).toHaveValue(
        'Loose hem'
      );
    });

    // The renter never sees any of this, so the form says so where the owner is filling it in
    // rather than leaving them to guess who reads it.
    it('tells the owner who can see it', () => {
      renderSpecialCare();

      expect(screen.getByText('EditListingDetailsForm.specialCareHelp')).toBeInTheDocument();
    });
  });
});
