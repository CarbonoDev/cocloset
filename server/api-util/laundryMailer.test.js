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
  notifyPickupScheduled,
  notifyReturnScheduled,
  notifyCleaningRequired,
} = require('./laundryMailer');

const ALL = [
  ['pickup-scheduled', notifyPickupScheduled],
  ['return-scheduled', notifyReturnScheduled],
  ['cleaning-required', notifyCleaningRequired],
];

describe('laundryMailer', () => {
  beforeEach(() => {
    isMailgunConfigured.mockReturnValue(true);
    sendMail.mockResolvedValue({ sent: true, id: 'msg-1' });
  });

  describe('the client requirement: no key, no send', () => {
    it.each(ALL)('%s makes no call at all when Mailgun is unconfigured', async (name, notify) => {
      isMailgunConfigured.mockReturnValue(false);

      const result = await notify({ to: 'studio@example.com', garmentTitle: 'A coat' });

      expect(result).toEqual({ sent: false, reason: 'not-configured' });
      expect(sendMail).not.toHaveBeenCalled();
      // Local dev, CI and the test suite must stay silent, not just inert.
      expect(log.error).not.toHaveBeenCalled();
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
