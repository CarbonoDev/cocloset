import { configureStore } from '@reduxjs/toolkit';
import routingReducer, { locationChanged } from '../ducks/routing.duck';
import { createAnalyticsListenerMiddleware } from './analytics';

const setup = () => {
  const handler = { trackPageView: jest.fn(), trackSearch: jest.fn() };
  const mw = createAnalyticsListenerMiddleware([handler]);
  const store = configureStore({
    reducer: { routing: routingReducer },
    middleware: gdm => gdm().prepend(mw.middleware),
  });
  const go = (path, search = '') =>
    store.dispatch(locationChanged({ location: { pathname: path, search }, canonicalPath: path }));
  return { handler, go };
};

describe('analytics middleware', () => {
  it('tracks a search once per new keywords value', () => {
    const { handler, go } = setup();
    go('/s');
    expect(handler.trackSearch).not.toHaveBeenCalled();
    go('/s', '?keywords=vestido');
    go('/s', '?keywords=vestido&pub_size=m');
    go('/s', '?keywords=falda');
    expect(handler.trackSearch.mock.calls).toEqual([['vestido'], ['falda']]);
    expect(handler.trackPageView).toHaveBeenCalledTimes(4);
  });
});
