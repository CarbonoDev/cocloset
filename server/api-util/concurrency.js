// Run `worker` over `items` with at most `limit` promises in flight.
//
// Extracted from server/api/laundry-orders.js, where it was built to run one
// Integration API `transactions.query` per listing (no native "transactions for
// any of these listing ids" filter exists - see that file's header). Any caller
// fanning out a per-item Integration API call should reuse this rather than
// re-deriving a concurrency limiter.
//
// @param {Array} items
// @param {number} limit - max concurrent `worker` calls in flight
// @param {function(item, index): Promise<*>} worker
// @returns {Promise<Array>} results in the same order as `items`
const mapWithConcurrency = (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runner = () => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) {
      return Promise.resolve();
    }
    return Promise.resolve(worker(items[index], index)).then(result => {
      results[index] = result;
      return runner();
    });
  };

  const runnerCount = Math.min(limit, items.length);
  return Promise.all(Array.from({ length: runnerCount }, runner)).then(() => results);
};

module.exports = { mapWithConcurrency };
