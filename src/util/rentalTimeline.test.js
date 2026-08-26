import {
  RENTAL_TIMELINE_STEPS,
  STEP_CURRENT,
  STEP_DONE,
  STEP_PENDING,
  TIMELINE_AUDIENCE_CUSTOMER,
  TIMELINE_AUDIENCE_PROVIDER,
  rentalTimelineSteps,
  timelineStatusFor,
  timelineStepMessageId,
} from './rentalTimeline';

// One list, two readers: the listing page describes how renting works, the inbox marks where a
// real rental has got to. These pin the marking - the description needs no test beyond the
// keys existing.

// Default audience is the customer, which is what the listing page renders and what most of
// these assert. The owner's list is exercised in its own describe below.
const statuses = state => timelineStatusFor(state).map(s => s.status);
const keyAt = status => timelineStatusFor(status).find(s => s.status === STEP_CURRENT)?.key;

const customerKeys = rentalTimelineSteps(TIMELINE_AUDIENCE_CUSTOMER).map(s => s.key);
const providerKeys = rentalTimelineSteps(TIMELINE_AUDIENCE_PROVIDER).map(s => s.key);

describe('timelineStatusFor', () => {
  it("always returns the reader's whole list, in order", () => {
    expect(timelineStatusFor('picked-up').map(s => s.key)).toEqual(customerKeys);
    expect(
      timelineStatusFor('picked-up', { audience: TIMELINE_AUDIENCE_PROVIDER }).map(s => s.key)
    ).toEqual(providerKeys);
  });

  it('marks the step a rental is on, and everything before it as done', () => {
    expect(statuses('ready-for-pickup')).toEqual([
      STEP_DONE,
      STEP_DONE,
      STEP_CURRENT,
      STEP_PENDING,
      STEP_PENDING,
      STEP_PENDING,
      STEP_PENDING,
    ]);
  });

  it('lands on the LATER of two steps that share one process state', () => {
    // The design splits "booking confirmed" from "laundry preparing", and "picked up" from
    // "rental active"; each pair is one process state. Marking the earlier twin would leave a
    // rental that is out with the customer showing "picked up" as still happening.
    expect(keyAt('accepted')).toBe('laundryPreparing');
    expect(keyAt('picked-up')).toBe('rentalActive');
  });

  it('treats an overdue rental as one in progress, not as its own step', () => {
    // The timeline says where the garment is. The lateness belongs to the status pill, which
    // is where a reader looks for a problem.
    expect(statuses('overdue')).toEqual(statuses('picked-up'));
  });

  it('counts a reviewed rental as a returned one, for every step but the review', () => {
    // A garment does not become un-returned because somebody wrote about it - so the garment
    // steps read the same. The review step is the one that moves, and it is asserted below.
    const withoutReview = state => statuses(state).slice(0, -1);

    ['reviewed', 'reviewed-by-customer', 'reviewed-by-provider'].forEach(state => {
      expect(withoutReview(state)).toEqual(withoutReview('delivered'));
    });
  });

  it('ends the owner on "ready for next rental" once the garment is back on the shelf', () => {
    const providerStatuses = timelineStatusFor('delivered', {
      audience: TIMELINE_AUDIENCE_PROVIDER,
    });

    expect(providerStatuses.find(s => s.key === 'readyForNextRental').status).toBe(STEP_CURRENT);
  });

  it('marks NOTHING before the rental has been accepted', () => {
    // A booking awaiting payment or the owner's answer has not started the story, and claiming
    // "booking confirmed" for one nobody has confirmed would be a lie on the first row.
    ['initial', 'inquiry', 'pending-payment', 'preauthorized'].forEach(state => {
      expect(statuses(state).every(s => s === STEP_PENDING)).toBe(true);
    });
  });

  it('marks nothing for a rental that never happened', () => {
    // Declined, expired, cancelled. These have no position on the happy path, and putting them
    // at one would tell a story about a rental that did not occur.
    ['declined', 'payment-expired', 'expired', 'canceled'].forEach(state => {
      expect(statuses(state).every(s => s === STEP_PENDING)).toBe(true);
    });
  });

  it('does not crash on an unknown or absent state', () => {
    [undefined, null, 'something-else'].forEach(state => {
      expect(timelineStatusFor(state)).toHaveLength(customerKeys.length);
    });
  });
});

// ---------------------------------------------------------------------------
//   > "aparecen para el customer Cleaning y Ready for next rental, el customer no tiene que
//   >  saber eso, laundry y provider si, podemos agregar para customer y provider los steps de
//   >  review? y para customer remover los dos steps que te menciono?"
// ---------------------------------------------------------------------------
describe('who sees which steps', () => {
  it("leaves the laundry's work off the renter's list", () => {
    expect(customerKeys).not.toContain('cleaning');
    expect(customerKeys).not.toContain('readyForNextRental');
  });

  it('keeps both of them for the owner, whose rental is not over until then', () => {
    expect(providerKeys).toContain('cleaning');
    expect(providerKeys).toContain('readyForNextRental');
  });

  it('gives both readers a review step', () => {
    expect(customerKeys[customerKeys.length - 1]).toBe('review');
    expect(providerKeys[providerKeys.length - 1]).toBe('review');
  });

  it('tells the same story about the garment up to the return', () => {
    // Everything before the split is shared, and in the same order - the two readers are
    // watching one rental.
    const upToReturn = keys => keys.slice(0, keys.indexOf('returnedToLaundry') + 1);

    expect(upToReturn(customerKeys)).toEqual(upToReturn(providerKeys));
  });

  it('defaults to the renter, which is who reads a listing page', () => {
    expect(rentalTimelineSteps().map(s => s.key)).toEqual(customerKeys);
  });
});

// ---------------------------------------------------------------------------
// The review step is the only one that is not "the rental reached this point" but "it is your
// turn, and have you taken it" - a different question for each party, since the process
// records the two reviews separately.
// ---------------------------------------------------------------------------
describe('the review step', () => {
  const reviewStatus = (state, audience) =>
    timelineStatusFor(state, { audience }).find(s => s.key === 'review').status;

  it('waits while the rental is still going on', () => {
    ['accepted', 'ready-for-pickup', 'picked-up', 'returned', 'cleaning'].forEach(state => {
      expect(reviewStatus(state, TIMELINE_AUDIENCE_CUSTOMER)).toBe(STEP_PENDING);
    });
  });

  it('becomes the current step for both once the rental is done', () => {
    expect(reviewStatus('delivered', TIMELINE_AUDIENCE_CUSTOMER)).toBe(STEP_CURRENT);
    expect(reviewStatus('delivered', TIMELINE_AUDIENCE_PROVIDER)).toBe(STEP_CURRENT);
  });

  // THE POINT OF DOING THIS PER READER. `reviewed-by-customer` means the CUSTOMER wrote one.
  // Folding both review states into "finished" - which is what happened before - told the
  // owner they had done something they had not.
  it('is done for whoever wrote the review, and still waiting for the other', () => {
    expect(reviewStatus('reviewed-by-customer', TIMELINE_AUDIENCE_CUSTOMER)).toBe(STEP_DONE);
    expect(reviewStatus('reviewed-by-customer', TIMELINE_AUDIENCE_PROVIDER)).toBe(STEP_CURRENT);

    expect(reviewStatus('reviewed-by-provider', TIMELINE_AUDIENCE_PROVIDER)).toBe(STEP_DONE);
    expect(reviewStatus('reviewed-by-provider', TIMELINE_AUDIENCE_CUSTOMER)).toBe(STEP_CURRENT);
  });

  it('is done for both once both have reviewed', () => {
    expect(reviewStatus('reviewed', TIMELINE_AUDIENCE_CUSTOMER)).toBe(STEP_DONE);
    expect(reviewStatus('reviewed', TIMELINE_AUDIENCE_PROVIDER)).toBe(STEP_DONE);
  });

  // A rental that did not happen has nothing to review.
  it('stays pending on a rental that never happened', () => {
    ['declined', 'expired', 'canceled', 'payment-expired'].forEach(state => {
      expect(reviewStatus(state, TIMELINE_AUDIENCE_CUSTOMER)).toBe(STEP_PENDING);
    });
  });
});

// ---------------------------------------------------------------------------
//   > "en el status 'Returned to laundry', podemos poner 'Returned to laundry - reported' solo
//   >  si la prenda fue reportada como dañada, si no tiene daños debe permanecer igual y el
//   >  resto de los pasos debe funcionar igual"
// ---------------------------------------------------------------------------
describe('timelineStepMessageId', () => {
  it('annotates the return step when damage was reported', () => {
    expect(timelineStepMessageId('returnedToLaundry', { damageReported: true })).toBe(
      'ListingPage.rentalTimeline.returnedToLaundryReported'
    );
  });

  it('leaves the return step alone when nothing was reported', () => {
    [{ damageReported: false }, {}, undefined].forEach(options => {
      expect(timelineStepMessageId('returnedToLaundry', options)).toBe(
        'ListingPage.rentalTimeline.returnedToLaundry'
      );
    });
  });

  // "el resto de los pasos debe funcionar igual" - damage is recorded AT the return, so no
  // other step can carry the annotation, whatever the flag says.
  it('never annotates any other step, even on a damaged rental', () => {
    RENTAL_TIMELINE_STEPS.filter(step => step.key !== 'returnedToLaundry').forEach(step => {
      expect(timelineStepMessageId(step.key, { damageReported: true })).toBe(
        `ListingPage.rentalTimeline.${step.key}`
      );
    });
  });

  // Only a real boolean. The caller reads `metadata.damageReported?.flag`, and the object it
  // sits on exists on rentals with no damage at all.
  it('treats a non-boolean flag as no report', () => {
    [{ damageReported: 'true' }, { damageReported: 1 }, { damageReported: {} }].forEach(o => {
      expect(timelineStepMessageId('returnedToLaundry', o)).toBe(
        'ListingPage.rentalTimeline.returnedToLaundry'
      );
    });
  });
});
