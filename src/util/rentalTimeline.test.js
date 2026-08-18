import {
  RENTAL_TIMELINE_STEPS,
  STEP_CURRENT,
  STEP_DONE,
  STEP_PENDING,
  timelineStatusFor,
} from './rentalTimeline';

// One list, two readers: the listing page describes how renting works, the inbox marks where a
// real rental has got to. These pin the marking - the description needs no test beyond the
// keys existing.

const statuses = state => timelineStatusFor(state).map(s => s.status);
const keyAt = status => timelineStatusFor(status).find(s => s.status === STEP_CURRENT)?.key;

describe('timelineStatusFor', () => {
  it('always returns all eight steps, in order', () => {
    expect(timelineStatusFor('picked-up').map(s => s.key)).toEqual(
      RENTAL_TIMELINE_STEPS.map(s => s.key)
    );
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

  it('counts a reviewed rental as finished', () => {
    // A garment does not become un-returned because somebody wrote about it.
    ['reviewed', 'reviewed-by-customer', 'reviewed-by-provider'].forEach(state => {
      expect(statuses(state)).toEqual(statuses('delivered'));
    });
    expect(keyAt('delivered')).toBe('readyForNextRental');
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
      expect(timelineStatusFor(state)).toHaveLength(RENTAL_TIMELINE_STEPS.length);
    });
  });
});
