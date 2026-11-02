const { mapWithConcurrency } = require('./concurrency');

describe('mapWithConcurrency', () => {
  it('returns results in the same order as the input, regardless of resolution order', async () => {
    const delays = [30, 10, 20];
    const results = await mapWithConcurrency(
      delays,
      3,
      delay => new Promise(resolve => setTimeout(() => resolve(delay), delay))
    );
    expect(results).toEqual(delays);
  });

  it('never runs more than `limit` workers at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async item => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return item;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 5, () => Promise.resolve('x'))).toEqual([]);
  });

  it('caps the runner count at the item count, not the limit', async () => {
    const calls = [];
    await mapWithConcurrency([1, 2], 10, item => {
      calls.push(item);
      return Promise.resolve(item);
    });
    expect(calls.sort()).toEqual([1, 2]);
  });
});
