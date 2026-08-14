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

// Several cases here deliberately break a post-transition side effect (the
// mailer, the calendar write, the custody write) to prove the endpoint still
// answers 200. Each logs through server/log.js by design, so without this the
// suite's output is mostly expected stack traces. Matches the other server
// endpoint tests (see init-user-role.test.js).
jest.mock('../log', () => ({ error: jest.fn() }));

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
      privateData: { turnaroundDays: 2 },
    },
  },
};

const listing = {
  id: { uuid: 'listing-1' },
  type: 'listing',
  attributes: {
    title: 'Draped jersey gown, crimson',
    metadata: { assignedLaundryId: LAUNDRY_ID },
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
//
// `listings.update` is here because the two return transitions now also stamp
// custody (`metadata.onLaundry`) and the readiness moment (`metadata.readyAt`)
// onto the LISTING - transaction metadata cannot answer "where is this garment",
// which outlives any one booking.
const setupSdk = ({ lastTransition, metadata = {}, transitionImpl, listingsUpdateImpl } = {}) => {
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
  const listingsUpdate =
    listingsUpdateImpl || jest.fn(() => Promise.resolve({ data: { data: listing } }));

  getIntegrationSdk.mockReturnValue({
    transactions: { show, transition },
    listings: { update: listingsUpdate },
  });
  return { show, transition, listingsUpdate };
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

  // -------------------------------------------------------------------------
  // The real return: custody, readiness, and the availability block.
  //
  // THIS BLOCK REPLACES an earlier `late-return buffer extension (design §6)`
  // describe, and three of its cases were rewritten rather than kept. Named
  // explicitly, because deleting an assertion is not something to do quietly:
  //
  //   * "extends the blocked window from the actual return date" asserted
  //     `start < bookingStart` and `end > bookingEnd`, i.e. that the window was
  //     computed from the BOOKING (bookingStart - bufferBefore .. actualReturn +
  //     bufferAfter). It is now computed from the RETURN MOMENT, which is the
  //     whole point of the change - the accept-time window was a forecast, this
  //     one is not. Rewritten below as "blocks from the day the garment came
  //     back", asserting the new arithmetic rather than being weakened.
  //   * "does nothing on an on-time return" asserted that only LATE returns
  //     recomputed availability. That was correct for a design-§6 late-extension
  //     and is wrong for a feature whose premise is that every real return
  //     replaces the estimate. Rewritten as its inverse, and the on-time/late
  //     symmetry is now asserted explicitly.
  //   * "never produces a window shorter than the one already blocked" existed
  //     to stop an inverted range when a transaction sat in `overdue` with a
  //     booking end in the future. A window anchored at `now` cannot invert, so
  //     the case it guarded is unreachable; the property it cared about
  //     (start < end, always) is re-asserted below without the booking fixture.
  //
  // No case was dropped for being inconvenient, and the file has more assertions
  // about returns than it did before.
  // -------------------------------------------------------------------------
  describe('the real return: custody, readiness and availability', () => {
    // 2-day configured turnaround (see laundryUser).
    const DEFAULT_DAYS = 2;
    const dayMs = 24 * 3600 * 1000;
    const utcMidnight = date =>
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

    it('stamps custody and the readiness moment onto the LISTING', async () => {
      const { listingsUpdate } = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      const res = await run({ transactionId: TX_ID, status: 'returned' });

      expect(listingsUpdate).toHaveBeenCalledTimes(1);
      const params = listingsUpdate.mock.calls[0][0];
      expect(params.id).toBe(listing.id);
      expect(params.metadata.onLaundry).toBe(true);
      expect(typeof params.metadata.readyAt).toBe('string');

      // Default readiness: the wash runs for the laundry's configured turnaround starting
      // the day AFTER the handover, so the garment is ready at the start of the day after
      // those. Asserted exactly rather than as a range - `readyAt` is now a midnight by
      // construction, and it is the field the checkout gate compares against.
      const readyAt = new Date(params.metadata.readyAt).getTime();
      expect(readyAt).toBe(utcMidnight(new Date()) + (DEFAULT_DAYS + 1) * dayMs);

      expect(res.body.data.custody).toMatchObject({
        onLaundry: true,
        cleaningDays: DEFAULT_DAYS,
        cleaningDaysSource: 'configured-turnaround',
        // The fixture laundry configures a studio-wide 48h and no category entry.
        // Reported so the studio can tell "3 days because you said so for Dresses"
        // apart from "3 days because nobody configured anything".
        turnaroundSource: 'studio',
      });
    });

    it('blocks from the day the garment came back, not from the booking', async () => {
      setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({ transactionId: TX_ID, status: 'returned' });

      expect(reconcileBufferWindow).toHaveBeenCalledTimes(1);
      const call = reconcileBufferWindow.mock.calls[0][0];
      expect(call.listingId).toBe(listing.id);
      // The window is anchored at today, and has nothing to do with the (2020)
      // booking dates the old implementation computed from.
      expect(call.start.getTime()).toBe(utcMidnight(new Date()));
      expect(call.start.getTime()).toBeGreaterThan(booking.attributes.end.getTime());
      expect(call.end.getTime()).toBeGreaterThan(call.start.getTime());
    });

    it('blocks the handover day plus every wash day the studio asked for', async () => {
      //   > "devuelven la prenda hoy 13, y la laundry ingresa que necesita 4 días de lavado,
      //   >  entonces la prenda debe estar disponible el 18, 4 días despues, no antes"
      //
      // 13th -> 18th is five calendar days blocked for four days of washing: the day the
      // garment is handed back over the counter is not a wash day.
      setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({ transactionId: TX_ID, status: 'returned', cleaningDays: 4 });

      const call = reconcileBufferWindow.mock.calls[0][0];
      expect(call.start.getTime()).toBe(utcMidnight(new Date()));
      expect((call.end.getTime() - call.start.getTime()) / dayMs).toBe(5);
    });

    it('blocks two days for a single wash day', async () => {
      // The case the old implementation got closest to wrong: with the window computed
      // from the exact return instant, a one-day turnaround only ever blocked the tail of
      // today and the whole of tomorrow when the clock happened to cooperate.
      setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({ transactionId: TX_ID, status: 'returned', cleaningDays: 1 });

      const call = reconcileBufferWindow.mock.calls[0][0];
      expect((call.end.getTime() - call.start.getTime()) / dayMs).toBe(2);
    });

    it('treats an on-time and a late return identically', async () => {
      setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      await run({ transactionId: TX_ID, status: 'returned' });
      const onTime = reconcileBufferWindow.mock.calls[0][0];

      reconcileBufferWindow.mockClear();
      setupSdk({ lastTransition: 'transition/mark-overdue' });
      await run({ transactionId: TX_ID, status: 'returned' });
      const late = reconcileBufferWindow.mock.calls[0][0];

      // Lateness is no longer a separate availability branch - it is just a return
      // whose moment happens to be past booking end, and the window is computed
      // from the moment either way.
      expect(late.start.getTime()).toBe(onTime.start.getTime());
      expect(late.end.getTime()).toBe(onTime.end.getTime());
    });

    it("uses the laundry's own cleaningDays over its configured turnaround", async () => {
      setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      const res = await run({ transactionId: TX_ID, status: 'returned', cleaningDays: 5 });

      expect(res.body.data.custody).toMatchObject({
        cleaningDays: 5,
        cleaningDaysSource: 'laundry',
      });
      // ...and does not report a turnaround source, because no default was used.
      expect(res.body.data.custody.turnaroundSource).toBeUndefined();
    });

    it('blocks nothing for cleaningDays: 0, but still records custody and readiness', async () => {
      const { listingsUpdate } = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      const res = await run({ transactionId: TX_ID, status: 'returned', cleaningDays: 0 });

      // "Ready today" means there is nothing to block. It does NOT mean the
      // garment is not in the studio.
      expect(reconcileBufferWindow).not.toHaveBeenCalled();
      expect(listingsUpdate.mock.calls[0][0].metadata.onLaundry).toBe(true);
      expect(res.body.data.custody).toMatchObject({ cleaningDays: 0, onLaundry: true });
    });

    it('rejects an unusable cleaningDays BEFORE firing the transition', async () => {
      // The transition is irreversible; a 400 after it fired would leave the
      // garment returned with an unblockable calendar and no way to correct it.
      const { transition } = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
      const res = await run({ transactionId: TX_ID, status: 'returned', cleaningDays: -1 });

      expect(res.statusCode).toBe(400);
      expect(transition).not.toHaveBeenCalled();
    });

    it.each([['a fractional value', 1.5], ['a numeric string', '3'], ['past the cap', 400]])(
      'rejects %s for cleaningDays',
      async (_label, cleaningDays) => {
        const { transition } = setupSdk({ lastTransition: 'transition/laundry-confirm-pickup' });
        const res = await run({ transactionId: TX_ID, status: 'returned', cleaningDays });

        expect(res.statusCode).toBe(400);
        expect(transition).not.toHaveBeenCalled();
      }
    );

    it('ignores cleaningDays on a step that is not a return', async () => {
      setupSdk({ lastTransition: 'transition/laundry-confirm-return' });
      const res = await run({
        transactionId: TX_ID,
        status: 'pending-cleaning',
        cleaningDays: 5,
      });

      expect(res.statusCode).toBe(200);
      expect(reconcileBufferWindow).not.toHaveBeenCalled();
      expect(res.body.data.custody).toBeUndefined();
    });

    it('does not touch custody on the non-return steps', async () => {
      const { listingsUpdate } = setupSdk({ lastTransition: 'transition/accept' });
      await run({ transactionId: TX_ID, status: 'ready-for-pickup' });
      expect(listingsUpdate).not.toHaveBeenCalled();
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

    it('still answers 200 when the custody write fails', async () => {
      const { listingsUpdate } = setupSdk({
        lastTransition: 'transition/laundry-confirm-pickup',
        listingsUpdateImpl: jest.fn(() => Promise.reject(new Error('403 Forbidden'))),
      });

      const res = await run({ transactionId: TX_ID, status: 'returned' });

      expect(listingsUpdate).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      // ...and the calendar work still happens: one failed write must not cascade.
      expect(reconcileBufferWindow).toHaveBeenCalled();
    });

    it('still answers 200 when the SDK has no listings resource at all', async () => {
      // A synchronous throw from the side-effect chain would otherwise escape into
      // the endpoint's catch and report a 500 for a transition that succeeded.
      getIntegrationSdk.mockReturnValue({
        transactions: {
          show: jest.fn(() =>
            Promise.resolve({
              data: {
                data: transactionEntity('transition/laundry-confirm-pickup'),
                included: [listing, booking, customer],
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

      const res = await run({ transactionId: TX_ID, status: 'returned' });
      expect(res.statusCode).toBe(200);
    });
  });
});
