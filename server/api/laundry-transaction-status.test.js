jest.mock('../api-util/sdk', () => ({
  handleError: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(),
}));

jest.mock('../api-util/laundryAuth', () => ({
  authorizeLaundryCaller: jest.fn(),
}));

jest.mock('../api-util/laundryMailer', () => ({
  notifyReturnScheduled: jest.fn(),
  notifyCleaningRequired: jest.fn(),
}));

jest.mock('../api-util/availabilityBuffer', () => ({
  reconcileBufferWindow: jest.fn(),
}));

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { authorizeLaundryCaller } = require('../api-util/laundryAuth');
const { handleError } = require('../api-util/sdk');
const { notifyReturnScheduled, notifyCleaningRequired } = require('../api-util/laundryMailer');
const { reconcileBufferWindow } = require('../api-util/availabilityBuffer');

const laundryTransactionStatus = require('./laundry-transaction-status');

const LAUNDRY_ID = 'laundry-1';
const TX_ID = { uuid: 'tx-1' };

const mockRes = () => ({
  statusCode: null,
  body: null,
  status: jest.fn(function(code) {
    this.statusCode = code;
    return this;
  }),
  set: jest.fn().mockReturnThis(),
  send: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  json: jest.fn(function(body) {
    this.body = body;
    return this;
  }),
  end: jest.fn().mockReturnThis(),
});

const laundryUser = {
  id: { uuid: LAUNDRY_ID },
  attributes: {
    email: 'studio@example.com',
    profile: {
      publicData: { laundryProfile: { studioName: 'Studio Pigalle' } },
      privateData: { turnaroundHours: 48 },
    },
  },
};

const listing = {
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: {
    title: 'Draped jersey gown, crimson',
    publicData: { assignedLaundryId: LAUNDRY_ID },
    privateData: { currentRack: 'Rack A-04' },
  },
};

// Deliberately in the past: a late return means the garment came back AFTER
// booking end, so a fixture with future dates would be testing a case that
// cannot happen.
const booking = {
  id: { uuid: 'booking-1' },
  type: 'booking',
  attributes: {
    start: new Date('2020-08-09T00:00:00.000Z'),
    end: new Date('2020-08-11T00:00:00.000Z'),
  },
};

const customer = {
  id: { uuid: 'customer-1' },
  type: 'user',
  attributes: { profile: { displayName: 'Jane Doe' } },
};

const transactionEntity = (lastTransition, metadata = {}) => ({
  id: TX_ID,
  type: 'transaction',
  attributes: { processName: 'cocloset-booking', lastTransition, metadata },
  relationships: {
    listing: { data: { id: listing.id, type: 'listing' } },
    booking: { data: { id: booking.id, type: 'booking' } },
    customer: { data: { id: customer.id, type: 'user' } },
  },
});

// Build an SDK whose transactions.show returns a transaction at
// `lastTransition`, and whose transactions.transition echoes the request back
// the way the real API does (expanded entity, merged metadata).
const setupSdk = ({ lastTransition, metadata = {}, transitionImpl } = {}) => {
  const show = jest.fn(() =>
    Promise.resolve({
      data: {
        data: transactionEntity(lastTransition, metadata),
        included: [listing, booking, customer],
      },
    })
  );
  const transition =
    transitionImpl ||
    jest.fn(params =>
      Promise.resolve({
        data: {
          data: {
            id: TX_ID,
            attributes: {
              lastTransition: params.transition,
              metadata: { ...metadata, ...(params.params?.metadata || {}) },
            },
          },
        },
      })
    );
  getIntegrationSdk.mockReturnValue({ transactions: { show, transition } });
  return { show, transition };
};

// Sharetribe's real answer to an illegal transition, verified against the Dev
// Integration API: HTTP 409, code `transaction-invalid-transition`.
const invalidTransitionError = () => {
  const error = new Error('Conflict');
  error.status = 409;
  error.statusText = 'Conflict';
  error.data = {
    errors: [{ status: 409, code: 'transaction-invalid-transition', title: 'Invalid transition.' }],
  };
  return error;
};

const run = async (body, res = mockRes()) => {
  await laundryTransactionStatus({ body }, res);
  await new Promise(setImmediate);
  return res;
};

describe('laundry-transaction-status', () => {
  beforeEach(() => {
    // The shared jest config sets `resetMocks: true`.
    authorizeLaundryCaller.mockResolvedValue(laundryUser);
    handleError.mockImplementation((res, e) => {
      res.status(e.status || 500);
      res.json({ error: e.statusText || 'error' });
      res.end();
    });
    reconcileBufferWindow.mockResolvedValue({
      exceptionIds: ['exc-1'],
      segmentsCreated: 1,
      alreadyBlocked: false,
      unblockedOverlaps: [],
    });
  });

  describe('request validation', () => {
    it('rejects a missing transactionId', async () => {
      setupSdk({ lastTransition: 'transition/accept' });
      const res = await run({ status: 'ready-for-pickup' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown status', async () => {
      setupSdk({ lastTransition: 'transition/accept' });
      const res = await run({ transactionId: TX_ID, status: 'teleported' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('authorization', () => {
    it('fires no transition when the caller is not a laundry user', async () => {
      const { transition } = setupSdk({ lastTransition: 'transition/accept' });
      const error = new Error('Caller is not a laundry user.');
      error.status = 403;
      error.statusText = 'Caller is not a laundry user.';
      error.data = {};
      authorizeLaundryCaller.mockRejectedValue(error);

      const res = await run({ transactionId: TX_ID, status: 'ready-for-pickup' });

      expect(res.statusCode).toBe(403);
      expect(transition).not.toHaveBeenCalled();
    });

    it("fires no transition when the caller is not THIS transaction's laundry", async () => {
      const { transition } = setupSdk({ lastTransition: 'transition/accept' });
      const error = new Error('Caller is not the laundry assigned to this resource.');
      error.status = 403;
      error.statusText = 'Caller is not the laundry assigned to this resource.';
      error.data = {};
      authorizeLaundryCaller.mockRejectedValue(error);

      const res = await run({ transactionId: TX_ID, status: 'picked-up' });

      expect(res.statusCode).toBe(403);
      expect(transition).not.toHaveBeenCalled();
    });

    it("authorizes against the listing's assignedLaundryId", async () => {
      setupSdk({ lastTransition: 'transition/accept' });
      await run({ transactionId: TX_ID, status: 'ready-for-pickup' });
      expect(authorizeLaundryCaller).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        LAUNDRY_ID
      );
    });
  });

  describe('status -> transition mapping', () => {
    it.each([
      ['ready-for-pickup', 'transition/accept', 'transition/laundry-mark-ready'],
      ['picked-up', 'transition/laundry-mark-ready', 'transition/laundry-confirm-pickup'],
      [
        'pending-cleaning',
        'transition/laundry-confirm-return',
        'transition/laundry-mark-pending-cleaning',
      ],
      [
        'cleaning-in-progress',
        'transition/laundry-mark-pending-cleaning',
        'transition/laundry-start-cleaning',
      ],
      [
        'quality-inspection',
        'transition/laundry-start-cleaning',
        'transition/laundry-start-quality-inspection',
      ],
      [
        'available-for-booking',
        'transition/laundry-start-quality-inspection',
        'transition/laundry-mark-available',
      ],
    ])('status %s fires %s', async (status, lastTransition, expected) => {
      const { transition } = setupSdk({ lastTransition });
      const res = await run({ transactionId: TX_ID, status });

      expect(res.statusCode).toBe(200);
      expect(transition).toHaveBeenCalledWith(
        expect.objectContaining({ id: TX_ID, transition: expected }),
        { expand: true }
      );
      expect(res.body.data.transition).toBe(expected);
    });
  });

  // The single most likely source of a runtime 409: `:from` is single-valued
  // in the EDN, so "the garment came back" is two different transitions.
  describe('the two-way `returned` branch', () => {
    it('fires laundry-confirm-return from picked-up', async () => {
      const { transition } = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      const res = await run({ transactionId: TX_ID, status: 'returned' });

      expect(transition.mock.calls[0][0].transition).toBe('transition/laundry-confirm-return');
      expect(res.body.data.state).toBe('returned');
    });

    it('fires laundry-confirm-return-late from overdue', async () => {
      const { transition } = setupSdk({ lastTransition: 'transition/mark-overdue' });
      const res = await run({ transactionId: TX_ID, status: 'returned' });

      expect(transition.mock.calls[0][0].transition).toBe('transition/laundry-confirm-return-late');
      expect(res.body.data.state).toBe('returned');
    });

    it('sends the same status for both, so the client never has to guess', async () => {
      const fromPickedUp = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({ transactionId: TX_ID, status: 'returned' });
      const a = fromPickedUp.transition.mock.calls[0][0].transition;

      const fromOverdue = setupSdk({ lastTransition: 'transition/mark-overdue' });
      await run({ transactionId: TX_ID, status: 'returned' });
      const b = fromOverdue.transition.mock.calls[0][0].transition;

      expect(a).not.toBe(b);
    });

    it('falls back to the on-time transition from an unexpected state, and lets Sharetribe judge', async () => {
      // Rather than guessing at a state we do not model, fire the ordinary
      // transition and let the platform answer 409 if it is wrong.
      const { transition } = setupSdk({ lastTransition: 'transition/accept' });
      await run({ transactionId: TX_ID, status: 'returned' });
      expect(transition.mock.calls[0][0].transition).toBe('transition/laundry-confirm-return');
    });
  });

  describe('transition metadata', () => {
    it('generates a ticket code on laundry-mark-ready, with the rack', async () => {
      const { transition } = setupSdk({ lastTransition: 'transition/accept' });
      const res = await run({ transactionId: TX_ID, status: 'ready-for-pickup' });

      const { metadata } = transition.mock.calls[0][0].params;
      expect(metadata.ticketCode).toEqual(expect.any(String));
      expect(metadata.ticketCode.length).toBeGreaterThan(0);
      expect(metadata.currentRack).toBe('Rack A-04');
      expect(res.body.data.ticketCode).toBe(metadata.ticketCode);
    });

    it('does not regenerate an existing ticket code', async () => {
      const { transition } = setupSdk({
        lastTransition: 'transition/accept',
        metadata: { ticketCode: 'PIG-EXISTING' },
      });
      await run({ transactionId: TX_ID, status: 'ready-for-pickup' });

      expect(transition.mock.calls[0][0].params.metadata.ticketCode).toBe('PIG-EXISTING');
    });

    it('writes a damage report on both return transitions', async () => {
      const onTime = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({
        transactionId: TX_ID,
        status: 'returned',
        damaged: true,
        damageNote: 'Small pull at left cuff.',
      });
      expect(onTime.transition.mock.calls[0][0].params.metadata.damageReported).toEqual({
        flag: true,
        note: 'Small pull at left cuff.',
      });

      const late = setupSdk({ lastTransition: 'transition/mark-overdue' });
      await run({
        transactionId: TX_ID,
        status: 'returned',
        damaged: true,
        damageNote: 'Torn hem',
      });
      expect(late.transition.mock.calls[0][0].params.metadata.damageReported).toEqual({
        flag: true,
        note: 'Torn hem',
      });
    });

    it('omits the damage report when the caller sent no flag', async () => {
      const { transition } = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({ transactionId: TX_ID, status: 'returned' });
      expect(transition.mock.calls[0][0].params.metadata.damageReported).toBeUndefined();
    });

    it.each([
      ['pending-cleaning', 'transition/laundry-confirm-return', 'pending-cleaning'],
      ['cleaning-in-progress', 'transition/laundry-mark-pending-cleaning', 'cleaning-in-progress'],
      ['quality-inspection', 'transition/laundry-start-cleaning', 'quality-inspection'],
    ])('writes cleaningPhase for %s', async (status, lastTransition, expectedPhase) => {
      const { transition } = setupSdk({ lastTransition });
      await run({ transactionId: TX_ID, status });
      expect(transition.mock.calls[0][0].params.metadata.cleaningPhase).toBe(expectedPhase);
    });

    it('never writes the retired lateReturn flag', async () => {
      const { transition } = setupSdk({ lastTransition: 'transition/mark-overdue' });
      await run({ transactionId: TX_ID, status: 'returned', damaged: false });
      expect(transition.mock.calls[0][0].params.metadata).not.toHaveProperty('lateReturn');
    });
  });

  describe('transition-not-allowed -> 409', () => {
    it("maps Sharetribe's refusal onto the same 409 the old pre-check returned", async () => {
      setupSdk({
        lastTransition: 'transition/accept',
        transitionImpl: jest.fn(() => Promise.reject(invalidTransitionError())),
      });

      const res = await run({ transactionId: TX_ID, status: 'available-for-booking' });

      expect(res.statusCode).toBe(409);
      expect(handleError).toHaveBeenCalled();
      const passed = handleError.mock.calls[0][1];
      expect(passed.status).toBe(409);
      expect(passed.statusText).toContain('available-for-booking');
    });

    it('also recognises the transition-not-allowed spelling', async () => {
      const error = invalidTransitionError();
      error.data.errors[0].code = 'transition-not-allowed';
      setupSdk({
        lastTransition: 'transition/accept',
        transitionImpl: jest.fn(() => Promise.reject(error)),
      });

      const res = await run({ transactionId: TX_ID, status: 'picked-up' });
      expect(res.statusCode).toBe(409);
    });

    it('does not swallow unrelated errors as 409s', async () => {
      const error = new Error('Not found');
      error.status = 404;
      error.statusText = 'Not found';
      error.data = { errors: [{ status: 404, code: 'not-found' }] };
      setupSdk({
        lastTransition: 'transition/accept',
        transitionImpl: jest.fn(() => Promise.reject(error)),
      });

      const res = await run({ transactionId: TX_ID, status: 'ready-for-pickup' });
      expect(res.statusCode).toBe(404);
    });

    it('does not run side effects when the transition was refused', async () => {
      setupSdk({
        lastTransition: 'transition/accept',
        transitionImpl: jest.fn(() => Promise.reject(invalidTransitionError())),
      });

      await run({ transactionId: TX_ID, status: 'returned' });

      expect(notifyCleaningRequired).not.toHaveBeenCalled();
      expect(reconcileBufferWindow).not.toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    it('sends Return Scheduled on laundry-confirm-pickup', async () => {
      setupSdk({ lastTransition: 'transition/laundry-mark-ready' });
      await run({ transactionId: TX_ID, status: 'picked-up' });

      expect(notifyReturnScheduled).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'studio@example.com',
          laundryName: 'Studio Pigalle',
          garmentTitle: 'Draped jersey gown, crimson',
          customerName: 'Jane Doe',
          returnDate: booking.attributes.end,
        })
      );
      expect(notifyCleaningRequired).not.toHaveBeenCalled();
    });

    it('sends Cleaning Required on both return transitions, carrying the damage flag', async () => {
      setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({
        transactionId: TX_ID,
        status: 'returned',
        damaged: true,
        damageNote: 'Torn hem',
      });

      expect(notifyCleaningRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'studio@example.com',
          damageReported: true,
          damageNote: 'Torn hem',
        })
      );

      notifyCleaningRequired.mockClear();
      setupSdk({ lastTransition: 'transition/mark-overdue' });
      await run({ transactionId: TX_ID, status: 'returned', damaged: false });

      expect(notifyCleaningRequired).toHaveBeenCalledWith(
        expect.objectContaining({ damageReported: false })
      );
    });

    it('sends nothing on the cleaning sub-phases', async () => {
      setupSdk({ lastTransition: 'transition/laundry-mark-pending-cleaning' });
      await run({ transactionId: TX_ID, status: 'cleaning-in-progress' });

      expect(notifyReturnScheduled).not.toHaveBeenCalled();
      expect(notifyCleaningRequired).not.toHaveBeenCalled();
    });

    it('still answers 200 when the mailer misbehaves', async () => {
      // laundryMailer never rejects, but a caller must not depend on that.
      notifyReturnScheduled.mockImplementation(() => {
        throw new Error('mail exploded');
      });
      setupSdk({ lastTransition: 'transition/laundry-mark-ready' });

      const res = await run({ transactionId: TX_ID, status: 'picked-up' });
      // The transition succeeded; a mail failure must not undo it.
      expect(res.statusCode).not.toBe(500);
    });
  });

  describe('late-return buffer extension (design §6)', () => {
    it('extends the blocked window from the actual return date', async () => {
      setupSdk({ lastTransition: 'transition/mark-overdue' });
      const res = await run({ transactionId: TX_ID, status: 'returned' });

      expect(reconcileBufferWindow).toHaveBeenCalledTimes(1);
      const call = reconcileBufferWindow.mock.calls[0][0];
      expect(call.listingId).toBe(listing.id);
      // Window starts before the booking and now runs past the original end,
      // because the garment came back after it.
      expect(call.start.getTime()).toBeLessThan(booking.attributes.start.getTime());
      expect(call.end.getTime()).toBeGreaterThan(booking.attributes.end.getTime());
      expect(res.body.data.bufferExtension).toBeTruthy();
    });

    it('does nothing on an on-time return', async () => {
      setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({ transactionId: TX_ID, status: 'returned' });
      expect(reconcileBufferWindow).not.toHaveBeenCalled();
    });

    it('never produces a window shorter than the one already blocked', async () => {
      // A transaction can sit in `overdue` while the actual return timestamp
      // is at or before booking end (clock skew, an edited booking). The
      // window must still be an extension, not an inverted range.
      const futureBooking = {
        ...booking,
        attributes: {
          start: new Date(Date.now() + 10 * 24 * 3600 * 1000),
          end: new Date(Date.now() + 12 * 24 * 3600 * 1000),
        },
      };
      getIntegrationSdk.mockReturnValue({
        transactions: {
          show: jest.fn(() =>
            Promise.resolve({
              data: {
                data: transactionEntity('transition/mark-overdue'),
                included: [listing, futureBooking, customer],
              },
            })
          ),
          transition: jest.fn(params =>
            Promise.resolve({
              data: {
                data: {
                  id: TX_ID,
                  attributes: { lastTransition: params.transition, metadata: {} },
                },
              },
            })
          ),
        },
      });

      await run({ transactionId: TX_ID, status: 'returned' });

      const call = reconcileBufferWindow.mock.calls[0][0];
      expect(call.end.getTime()).toBeGreaterThan(call.start.getTime());
      expect(call.end.getTime()).toBeGreaterThanOrEqual(futureBooking.attributes.end.getTime());
    });

    it('still answers 200 when the calendar write fails', async () => {
      reconcileBufferWindow.mockRejectedValue(new Error('exception overlap'));
      setupSdk({ lastTransition: 'transition/mark-overdue' });

      const res = await run({ transactionId: TX_ID, status: 'returned' });

      // The garment physically came back and Sharetribe recorded it. Failing
      // the request would make the ops UI retry a transition the platform
      // would then answer 409 for.
      expect(res.statusCode).toBe(200);
      expect(res.body.data.transition).toBe('transition/laundry-confirm-return-late');
    });
  });
});
