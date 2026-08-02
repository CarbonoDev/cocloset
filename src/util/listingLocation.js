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
 * @returns {{ address?: string, building?: string }} never null; `{}` when
 *   there is nothing to show
 */
export const getPickupLocation = publicData => {
  const { pickupAddress, assignedLaundryName, location } = publicData || {};

  if (pickupAddress) {
    return assignedLaundryName
      ? { address: pickupAddress, building: assignedLaundryName }
      : { address: pickupAddress };
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
