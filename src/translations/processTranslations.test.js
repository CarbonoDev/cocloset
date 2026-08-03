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
