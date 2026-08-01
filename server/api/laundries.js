const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { handleError } = require('../api-util/sdk');

// Public list of laundries (users flagged with metadata.isLaundry) used by the
// listing wizard's "Laundry Assignment" step. Only queryable via the
// Integration API (no public user search exists in the Marketplace API, for
// privacy reasons), so this endpoint deliberately returns only the fields a
// garment owner needs to pick a laundry: id, display name, and the laundry's
// own publicData (address, business hours, accepted categories, turnaround).
module.exports = (req, res) => {
  const integrationSdk = getIntegrationSdk();

  integrationSdk.users
    .query({ meta_isLaundry: true }, { expand: true })
    .then(response => {
      const laundries = response.data.data.map(user => ({
        id: user.id.uuid,
        displayName: user.attributes.profile.displayName,
        publicData: user.attributes.profile.publicData,
      }));

      res
        .status(200)
        .set('Content-Type', 'application/json')
        .send({ data: laundries })
        .end();
    })
    .catch(e => handleError(res, e));
};
