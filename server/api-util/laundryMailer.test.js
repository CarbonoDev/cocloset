jest.mock('./mailgun', () => ({
  sendMail: jest.fn(),
  isMailgunConfigured: jest.fn(),
}));

jest.mock('../log', () => ({
  error: jest.fn(),
  devLogger: jest.fn(),
}));

const { sendMail, isMailgunConfigured } = require('./mailgun');
const log = require('../log');

const {
  notifyNewIncomingGarment,
  notifyPickupScheduled,
  notifyReturnScheduled,
  notifyCleaningRequired,
} = require('./laundryMailer');

// Every laundry-facing notification, so the never-fail / always-log contracts are
// asserted for all of them rather than for whichever ones were remembered.
// `new-incoming-garment` joined the list when it was finally wired up (2026-08-10,
// from server/api/listing-laundry-assignment.js).
const ALL = [
  ['new-incoming-garment', notifyNewIncomingGarment],
  ['pickup-scheduled', notifyPickupScheduled],
  ['return-scheduled', notifyReturnScheduled],
  ['cleaning-required', notifyCleaningRequired],
];

describe('laundryMailer', () => {
  beforeEach(() => {
    isMailgunConfigured.mockReturnValue(true);
    sendMail.mockResolvedValue({ sent: true, id: 'msg-1' });
  });

  // REVISED REQUIREMENT (Jonathan, 2026-08-10): "debe fallar solo con log sin
  // impedir el flujo si no existe la key o si no tenemos el mail de la laundry".
  // The previous version of this block asserted the opposite of the first test
  // below - that nothing was logged - per the original "simplemente se ignora".
  //
  // Note WHY this layer needs its own log: the unconfigured check here
  // short-circuits before sendMail, so mailgun.js's own skip log never runs on
  // this path. This is the only place the line gets written for a laundry
  // notification, and with no Mailgun account yet, this path is every send.
  describe('the client requirement: no key, no send - but a log', () => {
    it.each(ALL)('%s makes no call at all when Mailgun is unconfigured', async (name, notify) => {
      isMailgunConfigured.mockReturnValue(false);

      const result = await notify({ to: 'studio@example.com', garmentTitle: 'A coat' });

      expect(result).toEqual({ sent: false, reason: 'not-configured' });
      expect(sendMail).not.toHaveBeenCalled();

      // ...and says so, naming which notification went nowhere.
      expect(log.error).toHaveBeenCalledTimes(1);
      const [error, code, data, options] = log.error.mock.calls[0];
      expect(error.message).toMatch(/Mailgun is not configured/);
      expect(code).toBe('laundry-mail-skipped-not-configured');
      expect(data).toMatchObject({ notification: name });
      expect(options).toEqual({ skipSentry: true });
    });

    it.each(ALL)('%s logs a missing recipient as a skip, not a failure', async (name, notify) => {
      isMailgunConfigured.mockReturnValue(true);

      const result = await notify({ garmentTitle: 'A coat' });

      expect(result).toEqual({ sent: false, reason: 'no-recipient' });
      expect(sendMail).not.toHaveBeenCalled();

      const [error, code, data, options] = log.error.mock.calls[0];
      expect(error.message).toMatch(/No recipient/);
      expect(code).toBe('laundry-mail-skipped-no-recipient');
      expect(data).toMatchObject({ notification: name });
      expect(options).toEqual({ skipSentry: true });
    });

    it.each(ALL)('%s distinguishes a skip from a genuine failure', async (name, notify) => {
      // Same helper, two different codes, so the two facts stay separable in the
      // log: nothing was attempted vs. composing the body threw.
      isMailgunConfigured.mockReturnValue(false);
      await notify({ to: 'studio@example.com' });
      const skipCode = log.error.mock.calls[0][1];

      expect(skipCode).toMatch(/^laundry-mail-skipped-/);
      expect(skipCode).not.toBe('laundry-mail-failed');
    });

    it.each(ALL)('%s still resolves, so no caller can be blocked', async (name, notify) => {
      isMailgunConfigured.mockReturnValue(false);

      // The contract every call site relies on: not awaited, cannot reject.
      await expect(notify({ to: 'studio@example.com' })).resolves.toMatchObject({ sent: false });
    });
  });

  describe('composition', () => {
    it('sends Pickup Scheduled with a subject and both body variants', async () => {
      await notifyPickupScheduled({
        to: 'studio@example.com',
        laundryName: 'Studio Pigalle',
        garmentTitle: 'Draped jersey gown',
        customerName: 'Jane Doe',
        pickupDate: new Date('2026-08-09T10:00:00.000Z'),
        transactionId: 'tx-1',
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.to).toBe('studio@example.com');
      expect(call.subject).toContain('pickup scheduled');
      expect(call.text).toContain('Draped jersey gown');
      expect(call.html).toContain('Draped jersey gown');
    });

    it('carries the damage flag into Cleaning Required', async () => {
      await notifyCleaningRequired({
        to: 'studio@example.com',
        garmentTitle: 'Wool trench',
        damageReported: true,
        damageNote: 'Small pull at left cuff.',
        transactionId: 'tx-1',
      });

      const call = sendMail.mock.calls[0][0];
      expect(call.text).toContain('Small pull at left cuff.');
      expect(call.text).toContain('inspect the garment before cleaning');
    });

    it('omits the damage section when nothing was reported', async () => {
      await notifyCleaningRequired({
        to: 'studio@example.com',
        garmentTitle: 'Wool trench',
        damageReported: false,
        transactionId: 'tx-1',
      });

      expect(sendMail.mock.calls[0][0].text).not.toContain('Damage reported');
    });

    it('tolerates entirely missing data rather than throwing inside a transition', async () => {
      await Promise.all(ALL.map(([, notify]) => notify({ to: 'studio@example.com' })));
      expect(sendMail).toHaveBeenCalledTimes(ALL.length);
      sendMail.mock.calls.forEach(([call]) => {
        expect(typeof call.subject).toBe('string');
        expect(call.subject.length).toBeGreaterThan(0);
      });
    });
  });

  describe('never fails the caller', () => {
    it.each(ALL)('%s resolves and logs when there is no recipient', async (name, notify) => {
      const result = await notify({ garmentTitle: 'A coat' });

      expect(result).toEqual({ sent: false, reason: 'no-recipient' });
      expect(sendMail).not.toHaveBeenCalled();
      // Somebody has configured a laundry we cannot reach - worth one log.
      expect(log.error).toHaveBeenCalled();
    });

    it.each(ALL)('%s resolves when the transport itself fails', async (name, notify) => {
      // sendMail is documented never to reject, but the wrapper must not
      // depend on that: these hang off transitions that already succeeded.
      sendMail.mockResolvedValue({ sent: false, reason: 'error' });
      await expect(notify({ to: 'studio@example.com' })).resolves.toMatchObject({ sent: false });
    });
  });
});
