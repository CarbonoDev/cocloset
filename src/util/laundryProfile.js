/**
 * Is a laundry's stored address good enough for the marketplace to use?
 *
 * WHY THIS MATTERS TO A STUDIO
 * `/api/laundries` — the picker a garment owner chooses a studio from — drops any
 * laundry whose profile is not *usable*, and the assignment endpoint refuses one
 * outright ("The chosen laundry has no usable address or location"). Both apply
 * the same rule, and neither tells the studio: it is filtered out of a list it
 * cannot see, so its symptom is silence. That is what makes this predicate a UI
 * concern and not only a server one.
 *
 *   > "la laundry no puede estar en la lista de disponibles si no tiene dirección,
 *   >  por lo que en el form de laundry hay que poner una alerta llamativa de que
 *   >  no se le pueden asignar prendas si no tiene dirección establecida"
 *
 * TWO CONDITIONS, NOT ONE. An address STRING is not sufficient — the server also
 * requires a usable `origin` (a real coordinate pair). A studio with a typed
 * address and no geocoded origin is excluded exactly as hard as one with no
 * address at all, because assigning it would write no `geolocation` onto the
 * listing and leave the owner's wizard permanently unpublishable. An alert that
 * only checked for a string would tell such a studio "you have an address" while
 * it kept receiving nothing.
 *
 * ESM TWIN OF server/api-util/laundryDirectory.js `hasUsableLaundryProfile`
 * (+ its `parseOrigin`). It is duplicated rather than imported because `src` is
 * ESM bundled for the browser and `server` is CommonJS run directly by node —
 * the same reason server/api-util/categoryPricing.js is a "CommonJS twin" of
 * src/util/fieldHelpers.js and server/api-util/dates.js is copied from
 * src/util/dates.js.
 *
 * DRIFT GUARD: laundryProfile.test.js imports the real server predicate and
 * asserts the two agree, case for case. If you change either side, that test is
 * where you will find out.
 *
 * The server predicate also requires an `id`. There is no client-side twin of
 * that condition on purpose: this runs on the laundry's own settings page, where
 * the id is the logged-in `currentUser` and cannot be missing.
 *
 * @param {Object} [laundryProfile] - `publicData.laundryProfile` from a laundry's profile
 * @returns {boolean} true only if a garment can actually be assigned to this studio
 */
export const hasUsableLaundryAddress = laundryProfile => {
  const { address, origin } = laundryProfile || {};
  const lat = origin?.lat;
  const lng = origin?.lng;
  const hasUsableOrigin =
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng);

  return !!address && hasUsableOrigin;
};

/**
 * Convenience wrapper for callers holding a whole currentUser entity.
 *
 * @param {Object} [user] - a currentUser / user entity
 * @returns {boolean}
 */
export const hasUsableLaundryAddressForUser = user =>
  hasUsableLaundryAddress(user?.attributes?.profile?.publicData?.laundryProfile);

/**
 * Has an admin granted this studio a one-off address change?
 *
 * The flag lives in the laundry user's `metadata`, which only the Integration API
 * can write — a flag the laundry could set for itself would not be a permission.
 * A user's own `metadata` IS readable through the ordinary Marketplace API, which is
 * what lets this form read it without a server round trip.
 *
 * Strict `=== true`: `'true'`, `1` and `{}` must not unlock anything. ESM twin of
 * server/api-util/laundryAddress.js `readAddressChangeAllowed`.
 *
 * @param {Object} [user] - a currentUser / user entity
 * @returns {boolean}
 */
export const isLaundryAddressChangeAllowed = user =>
  user?.attributes?.profile?.metadata?.addressChangeAllowed === true;

/**
 * May this studio change its own address right now?
 *
 * ESM twin of server/api-util/laundryAddress.js `evaluateAddressChange`, and the
 * single thing the form's lock is driven by. Two branches:
 *
 *   1. NO USABLE ADDRESS YET -> yes, always. Onboarding has to work: a studio with
 *      no address is invisible in the picker and can be assigned nothing, so a
 *      permanently disabled empty field would strand every new studio behind a
 *      support ticket. This includes a studio that typed an address but has no
 *      usable `origin` — the server excludes that one just as hard, so it is just
 *      as much "not set up yet".
 *   2. An admin has granted the change -> yes, once.
 *
 * Otherwise no, and the form says to contact the administrator or support.
 *
 * IT IS THE UI'S RULE, NOT THE ENFORCEMENT. The real decision is taken again
 * server-side in server/api/laundry-address.js against the stored user, and — said
 * plainly because the code must not overstate it — even that gates only our own
 * write path: the address is in the laundry's `publicData`, which it can write
 * directly against the Marketplace API. See the header of
 * server/api-util/laundryAddress.js.
 *
 * @param {Object} [user] - a currentUser entity
 * @returns {boolean}
 */
export const canChangeLaundryAddress = user =>
  !hasUsableLaundryAddressForUser(user) || isLaundryAddressChangeAllowed(user);
