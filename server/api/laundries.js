const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');

// Public list of laundries (users flagged with metadata.isLaundry) used by the
// listing wizard's "Laundry Assignment" step. Only queryable via the
// Integration API (no public user search exists in the Marketplace API, for
// privacy reasons), so this endpoint deliberately returns only the fields a
// garment owner needs to pick a laundry: id, display name, the laundry's own
// publicData (address, business hours, accepted categories), and turnaround
// hours. Turnaround is normally stored as privateData on the laundry's user
// profile (laundry+operator visible only - see LaundryProfilePage), but the
// Laundry Assignment card picker (mockup 12.jpg) needs to show it to garment
// owners before they pick a laundry, so this endpoint deliberately surfaces
// that one field. cleaningFee (the other privateData field on the laundry
// profile) is NOT exposed here - it's used server-side for pricing, not shown
// during listing creation.
module.exports = (req, res) => {
  const integrationSdk = getIntegrationSdk();

  integrationSdk.users
    .query({ meta_isLaundry: true }, { expand: true })
    .then(response => {
      const laundries = response.data.data.map(user => ({
        id: user.id.uuid,
        displayName: user.attributes.profile.displayName,
        publicData: user.attributes.profile.publicData,
        turnaroundHours: user.attributes.profile.privateData?.turnaroundHours,
      }));

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: laundries })
        .end();
    })
    .catch(e => handleError(res, e));
};
