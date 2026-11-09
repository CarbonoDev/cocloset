import { createListenerMiddleware } from '@reduxjs/toolkit';
import { locationChanged } from '../ducks/routing.duck';

const keywordsOf = location => new URLSearchParams(location?.search || '').get('keywords')?.trim();

// Create a Redux Toolkit listener middleware for analytics handlers. Each
// handler should have the following methods:
//
// - trackPageView(canonicalPath, previousPath): called when the URL is changed
// - trackSearch(searchTerm) (optional): called when the keywords URL param changes to a new
//   non-empty value (i.e. the user searched for something)
export const createAnalyticsListenerMiddleware = handlers => {
  const listenerMiddleware = createListenerMiddleware();

  listenerMiddleware.startListening({
    actionCreator: locationChanged,
    effect: (action, listenerApi) => {
      const { canonicalPath, location } = action.payload;
      const previousRouting = listenerApi.getOriginalState()?.routing;
      const previousPath = previousRouting?.currentCanonicalPath;
      const searchTerm = keywordsOf(location);
      const isNewSearch =
        !!searchTerm && searchTerm !== keywordsOf(previousRouting?.currentLocation);

      handlers.forEach(handler => {
        handler.trackPageView(canonicalPath, previousPath);
        if (isNewSearch) {
          handler.trackSearch?.(searchTerm);
        }
      });
    },
  });

  return listenerMiddleware;
};

// Legacy export for backward compatibility
export const createMiddleware = createAnalyticsListenerMiddleware;
