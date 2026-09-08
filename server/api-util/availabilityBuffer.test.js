jest.mock('../log', () => ({ error: jest.fn() }));

const { writeBufferExceptionIds } = require('./availabilityBuffer');

// WHY THIS FILE EXISTS
//
//   > "los días reservados deberían estar disponibles, sin embargo no lo estan"
//   >   (Jonathan, 2026-09-07)
//
// The ids of the availability exceptions a booking creates used to be returned in an HTTP
// response and then forgotten. That is what made a cancelled rental's block permanent: an
// availability exception carries no metadata of ours, so without this record there is no way
// to tell a block this platform created from one an owner created - and therefore no safe way
// to remove either. Everything server/api/listing-availability-sweep.js is allowed to delete
// rests on what is written here.

const TX_ID = { uuid: 'tx-1' };

const sdkWith = updateImpl => {
  const updateMetadata = updateImpl || jest.fn(() => Promise.resolve({ data: { data: {} } }));
  return { sdk: { transactions: { updateMetadata } }, updateMetadata };
};

const transaction = (bufferExceptionIds = undefined) => ({
  id: TX_ID,
  attributes: { metadata: bufferExceptionIds ? { bufferExceptionIds } : {} },
});

describe('writeBufferExceptionIds', () => {
  it('records what this booking blocked', async () => {
    const { sdk, updateMetadata } = sdkWith();

    await writeBufferExceptionIds({
      integrationSdk: sdk,
      transaction: transaction(),
      exceptionIds: ['exc-1', 'exc-2'],
      txIdForLog: 'tx-1',
    });

    expect(updateMetadata).toHaveBeenCalledWith({
      id: TX_ID,
      metadata: { bufferExceptionIds: ['exc-1', 'exc-2'] },
    });
  });

  it('appends rather than replaces', async () => {
    // A retry blocks the segments the first attempt missed, and both sets belong to this
    // booking. Replacing would strand the first set on the calendar with nothing owning it -
    // which is precisely the state this whole record exists to prevent.
    const { sdk, updateMetadata } = sdkWith();

    await writeBufferExceptionIds({
      integrationSdk: sdk,
      transaction: transaction(['exc-1']),
      exceptionIds: ['exc-2'],
      txIdForLog: 'tx-1',
    });

    expect(updateMetadata.mock.calls[0][0].metadata.bufferExceptionIds).toEqual(['exc-1', 'exc-2']);
  });

  it('does not record the same id twice', async () => {
    const { sdk, updateMetadata } = sdkWith();

    await writeBufferExceptionIds({
      integrationSdk: sdk,
      transaction: transaction(['exc-1']),
      exceptionIds: ['exc-1'],
      txIdForLog: 'tx-1',
    });

    expect(updateMetadata.mock.calls[0][0].metadata.bufferExceptionIds).toEqual(['exc-1']);
  });

  it('writes nothing when nothing was created', async () => {
    // `alreadyBlocked` is the ordinary case on a re-run: the window is covered and this run
    // created no exceptions. Writing an empty list would clear a real record.
    const { sdk, updateMetadata } = sdkWith();

    await writeBufferExceptionIds({
      integrationSdk: sdk,
      transaction: transaction(['exc-1']),
      exceptionIds: [],
      txIdForLog: 'tx-1',
    });

    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it('does not reject when the write fails', async () => {
    // The window is already blocked, which is the part that protects the garment. Losing this
    // record costs the cleanup, not the booking - so it must never fail the caller.
    const failing = jest.fn(() => Promise.reject(new Error('boom')));
    const { sdk } = sdkWith(failing);

    await expect(
      writeBufferExceptionIds({
        integrationSdk: sdk,
        transaction: transaction(),
        exceptionIds: ['exc-1'],
        txIdForLog: 'tx-1',
      })
    ).resolves.toEqual(['exc-1']);
  });
});
