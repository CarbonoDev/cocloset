/**
 * Where a garment is picked up and returned.
 *
 * BACKGROUND: in stock Sharetribe, EditListingLocationPanel wrote the
 * listing's `geolocation` plus `publicData.location = { address, building }`,
 * and every display surface read `publicData.location`.
 *
 * Cocloset repurposed that panel: the owner's own address is now PRIVATE
 * (`privateData.ownerAddress`), and the listing's public location — the place
 * a renter actually goes — is the assigned laundry's. EditListingLaundryPanel
 * writes it as `publicData.pickupAddress` + `publicData.assignedLaundryName`,
 * and copies the laundry's coordinates onto the listing's `geolocation`.
 *
 * That left every reader of `publicData.location` rendering nothing — most
 * visibly the entire pickup/location block on the checkout page. This helper
 * is the single place that knows both shapes, so a reader can't be missed
 * again.
 *
 * It returns the `{ address, building }` shape the existing display components
 * (AddressLinkMaybe, LocationDetails, SectionMapMaybe) already understand,
 * with the laundry's name in `building` — those components render it as
 * "Studio Pigalle, 21 Rue Frochot, Paris", which is what a renter needs.
 *
 * LEGACY FALLBACK: listings created before this change still carry
 * `publicData.location` (the owner's home address) and no `pickupAddress`.
 * Falling back to it keeps those listings rendering rather than showing a
 * blank block — but note that address is the OWNER's, which is the privacy
 * problem this change was meant to close. Clearing it needs a data migration;
 * see "Migration - publicData.location" in
 * /workspace/vault/Projects/Cocloset/Design - Laundry Process & Data Model.md.
 * Once that migration has run, the fallback branch can be deleted.
 *
 * @param {Object} [publicData] - a listing's `attributes.publicData`
 * @returns {{ address?: string, building?: string, neighborhood?: string }} never null; `{}` when
 *   there is nothing to show
 */
export const getPickupLocation = publicData => {
  const { pickupAddress, assignedLaundryName, pickupNeighborhood, location } = publicData || {};

  if (pickupAddress) {
    return {
      address: pickupAddress,
      ...(assignedLaundryName ? { building: assignedLaundryName } : {}),
      ...(pickupNeighborhood ? { neighborhood: pickupNeighborhood } : {}),
    };
  }

  return location || {};
};

/**
 * Convenience wrapper for callers that hold a whole listing entity.
 *
 * @param {Object} [listing]
 * @returns {{ address?: string, building?: string }}
 */
export const getListingPickupLocation = listing =>
  getPickupLocation(listing?.attributes?.publicData);

/**
 * The pickup location, but ONLY when it genuinely came from an assigned laundry.
 *
 * WHY THIS EXISTS ALONGSIDE getPickupLocation, RATHER THAN REPLACING IT.
 * getPickupLocation deliberately falls back to the legacy `publicData.location`
 * so that pre-repurposing listings keep rendering *something* in blocks that
 * would otherwise go blank (checkout's pickup panel, the map's address label).
 * For a block whose entire purpose is to PRINT the address as prose, that
 * fallback is not a graceful degradation — it is a privacy incident. On listings
 * created before EditListingLocationPanel was repurposed, `publicData.location`
 * holds the OWNER'S OWN HOME ADDRESS (see the header comment above), and
 * ListingPage is a fully public page.
 *
 * So the rule for any *new* reader that renders the address as text is: gate on
 * the laundry-derived value, never on "whatever the helper returns".
 * `publicData.pickupAddress` is that marker — the only writer of it is
 * server/api/listing-laundry-assignment.js, which resolves it server-side from
 * the chosen laundry's own profile in the same Integration API call that writes
 * `metadata.assignedLaundryId` and the listing's `geolocation`. If it is absent,
 * no laundry has ever been assigned and there is no public address to show.
 *
 * Returns `null` (not `{}`) so a caller has to make a decision about the empty
 * case instead of rendering an empty string into a paragraph.
 *
 * @param {Object} [publicData] - a listing's `attributes.publicData`
 * @returns {{ address: string, building?: string }|null} null when the address
 *   is absent or is only the legacy owner-derived `publicData.location`
 */
export const getAssignedLaundryLocation = publicData => {
  // Reuse the single place that knows the stored shape, then keep only the
  // laundry-derived branch of its answer.
  return publicData?.pickupAddress ? getPickupLocation(publicData) : null;
};
