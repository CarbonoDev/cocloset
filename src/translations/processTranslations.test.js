import en from './en.json';

// Several translation keys are namespaced by transaction process name, e.g.
// `EditListingWizard.<process>.new.saveLocation`. Cocloset runs on a custom process
// (`cocloset-booking`) rather than the stock `default-booking`, and react-intl renders a
// missing key as the key itself — so a gap here ships a button reading
// "EditListingWizard.cocloset-booking.new.saveLocation" to a real user. That is exactly
// what happened when the process was switched, and nothing failed to warn us.
const STOCK_PROCESS = 'default-booking';
const COCLOSET_PROCESS = 'cocloset-booking';

const keysFor = process =>
  Object.keys(en)
    .filter(key => key.includes(`.${process}.`))
    .map(key => key.replace(`.${process}.`, '.{process}.'));

describe('process-namespaced translations', () => {
  it('defines a cocloset-booking key for every default-booking key', () => {
    const stock = keysFor(STOCK_PROCESS);
    const cocloset = new Set(keysFor(COCLOSET_PROCESS));

    const missing = stock
      .filter(generic => !cocloset.has(generic))
      .map(generic => generic.replace('.{process}.', `.${COCLOSET_PROCESS}.`));

    expect(missing).toEqual([]);
  });

  it('has no empty values among the cocloset-booking keys', () => {
    // An empty string is a subtler version of the same failure: it renders as nothing at
    // all, so a button silently loses its label rather than showing a visible key.
    const blank = Object.entries(en)
      .filter(([key, value]) => key.includes(`.${COCLOSET_PROCESS}.`))
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key);

    expect(blank).toEqual([]);
  });
});

describe('cocloset-booking wizard save buttons', () => {
  // These are the subtler failure: every key exists, so nothing renders as a literal key -
  // the buttons simply lie. cocloset-booking now runs Photos → Details → Pricing → Laundry
  // (see tabsForListingType), so the button that used to publish (Photos) has to say "next"
  // and the one that used to say "next" (Laundry) has to publish. Getting this wrong ships
  // a "Publish listing" button on step 1 that saves nothing and advances, and a "Next" on
  // the final step that publishes - both indistinguishable from a working wizard until
  // someone uses it.
  //
  // Asserted on wording rather than on an exact string so a copy edit does not fail here,
  // while a swapped pair still does.
  const savePhotos = en['EditListingWizard.cocloset-booking.new.savePhotos'];
  const saveLaundry = en['EditListingWizard.cocloset-booking.new.saveLaundry'];
  const saveStyle = en['EditListingWizard.cocloset-booking.new.saveStyle'];

  it('does not promise publication on the first step', () => {
    expect(savePhotos.toLowerCase()).not.toContain('publish');
    // The alternative first step, used when the listing type does not require images.
    expect(saveStyle.toLowerCase()).not.toContain('publish');
  });

  it('promises publication on the last step', () => {
    expect(saveLaundry.toLowerCase()).toContain('publish');
  });

  it('keeps the stock booking process untouched', () => {
    // default-booking still ends on Photos, so its labels must NOT have been swapped along
    // with cocloset's.
    expect(en['EditListingWizard.default-booking.new.savePhotos'].toLowerCase()).toContain(
      'publish'
    );
    expect(en['EditListingWizard.default-booking.new.saveLaundry'].toLowerCase()).not.toContain(
      'publish'
    );
  });

  it('keeps the now-orphaned location and availability keys', () => {
    // cocloset-booking no longer has those steps, but the keys must stay: the coverage test
    // above requires a cocloset counterpart for every default-booking key, and those two
    // processes still use them.
    expect(en['EditListingWizard.cocloset-booking.new.saveLocation']).toBeTruthy();
    expect(en['EditListingWizard.cocloset-booking.new.saveAvailability']).toBeTruthy();
  });
});
