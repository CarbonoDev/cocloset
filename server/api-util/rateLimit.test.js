const { createRateLimiter } = require('./rateLimit');

describe('createRateLimiter', () => {
  it('allows up to maxPerKey requests per key within a window', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxPerKey: 2, maxTotal: 100 });

    expect(limiter.check('1.1.1.1').allowed).toBe(true);
    expect(limiter.check('1.1.1.1').allowed).toBe(true);
    expect(limiter.check('1.1.1.1').allowed).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxPerKey: 1, maxTotal: 100 });

    expect(limiter.check('1.1.1.1').allowed).toBe(true);
    expect(limiter.check('1.1.1.1').allowed).toBe(false);
    expect(limiter.check('2.2.2.2').allowed).toBe(true);
  });

  it('enforces a global budget across keys', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxPerKey: 10, maxTotal: 2 });

    expect(limiter.check('1.1.1.1').allowed).toBe(true);
    expect(limiter.check('2.2.2.2').allowed).toBe(true);
    expect(limiter.check('3.3.3.3').allowed).toBe(false);
  });

  it('rolls the window once windowMs has elapsed', () => {
    let now = 0;
    const limiter = createRateLimiter({
      windowMs: 1000,
      maxPerKey: 1,
      maxTotal: 100,
      now: () => now,
    });

    expect(limiter.check('1.1.1.1').allowed).toBe(true);
    now = 999;
    expect(limiter.check('1.1.1.1').allowed).toBe(false);
    now = 1000;
    expect(limiter.check('1.1.1.1').allowed).toBe(true);
  });

  it('reports how long the caller should wait', () => {
    let now = 0;
    const limiter = createRateLimiter({
      windowMs: 10000,
      maxPerKey: 1,
      maxTotal: 100,
      now: () => now,
    });

    limiter.check('1.1.1.1');
    now = 4000;
    const result = limiter.check('1.1.1.1');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(6);
  });

  it('buckets missing keys together instead of throwing', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxPerKey: 1, maxTotal: 100 });

    expect(limiter.check(undefined).allowed).toBe(true);
    expect(limiter.check(undefined).allowed).toBe(false);
  });

  it('clears state on reset', () => {
    const limiter = createRateLimiter({ windowMs: 1000, maxPerKey: 1, maxTotal: 100 });

    limiter.check('1.1.1.1');
    limiter.reset();

    expect(limiter.check('1.1.1.1').allowed).toBe(true);
  });
});
