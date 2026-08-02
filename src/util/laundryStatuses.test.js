/**
 * Drift guard for the client copy of the laundry status vocabularies.
 *
 * `src/util/laundryStatuses.js` deliberately duplicates two lists that are
 * defined and enforced server-side, because neither side can import the other
 * (webpack's ModuleScopePlugin blocks `src/` -> `server/`, and the un-Babeled
 * CommonJS server can't require ESM out of `src/`). See the long comment at the
 * top of that file.
 *
 * Jest has no such restriction, so this test reaches across the boundary and
 * asserts the copies still match. If either side is edited alone, this fails.
 */
const {
  LAUNDRY_STATUSES: serverLaundryStatuses,
  isLegalNextLaundryStatus,
} = require('../../server/api-util/laundryStatusHelpers');
const {
  READINESS_STATUSES: serverReadinessStatuses,
} = require('../../server/api/listing-readiness-status');

import {
  LAUNDRY_STATUSES,
  READINESS_STATUSES,
  DAMAGE_REPORT_STATUS,
  nextLaundryStatus,
  statusLabelKey,
} from './laundryStatuses';

describe('laundryStatuses', () => {
  describe('stays in sync with the server definitions', () => {
    it('LAUNDRY_STATUSES matches server/api-util/laundryStatusHelpers.js', () => {
      expect(LAUNDRY_STATUSES).toEqual(serverLaundryStatuses);
    });

    it('READINESS_STATUSES matches server/api/listing-readiness-status.js', () => {
      expect(READINESS_STATUSES).toEqual(serverReadinessStatuses);
    });

    it('DAMAGE_REPORT_STATUS is a real status in the sequence', () => {
      expect(serverLaundryStatuses).toContain(DAMAGE_REPORT_STATUS);
    });
  });

  describe('nextLaundryStatus', () => {
    it('starts the sequence when nothing is set yet', () => {
      expect(nextLaundryStatus(null)).toBe('ready-for-pickup');
      expect(nextLaundryStatus(undefined)).toBe('ready-for-pickup');
    });

    it('returns the immediate next status', () => {
      expect(nextLaundryStatus('ready-for-pickup')).toBe('picked-up');
      expect(nextLaundryStatus('picked-up')).toBe('returned');
      expect(nextLaundryStatus('quality-inspection')).toBe('available-for-booking');
    });

    it('returns null at the end of the sequence', () => {
      expect(nextLaundryStatus('available-for-booking')).toBeNull();
    });

    it('returns null for an unrecognized status', () => {
      expect(nextLaundryStatus('not-a-status')).toBeNull();
    });

    it('only ever proposes a move the server would accept', () => {
      [null, ...LAUNDRY_STATUSES].forEach(current => {
        const next = nextLaundryStatus(current);
        if (next !== null) {
          expect(isLegalNextLaundryStatus(current, next)).toBe(true);
        }
      });
    });
  });

  describe('statusLabelKey', () => {
    it('prefers the transaction laundry status', () => {
      expect(statusLabelKey({ laundryStatus: 'picked-up', readinessStatus: 'stored' })).toBe(
        'LaundryOpsPage.status.picked-up'
      );
    });

    it('falls back to the listing readiness status', () => {
      expect(statusLabelKey({ laundryStatus: null, readinessStatus: 'incoming' })).toBe(
        'LaundryOpsPage.readiness.incoming'
      );
    });

    it('returns null when the row has no status at all', () => {
      expect(statusLabelKey({})).toBeNull();
      expect(statusLabelKey(null)).toBeNull();
    });
  });
});
