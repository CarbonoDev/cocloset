import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { laundryActionsFor, statusLabelKey } from '../../util/laundryStatuses';
import { handoverQrPayloadFromRecord } from '../../util/handoverQr';
import { isHandoverQrVisibleState } from '../../transactions/transactionProcessCoclosetBooking';
import { isLate } from './LaundryOpsPage.helpers';
import { HandoverQrCode, InlineTextButton, PrimaryButton } from '../../components';

import { statusTone } from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

const formatBookingDate = (isoString, intl) =>
  isoString
    ? intl.formatDate(new Date(isoString), { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

/**
 * One row of the laundry ops orders table (mockups 05-08.jpg), plus the
 * expandable detail panel that carries the advance action.
 *
 * The action offered is whatever `laundryActionsFor` says is legal from the
 * transaction's REAL process state - Sharetribe now enforces the ordering, so
 * offering anything else would just build a UI for requests that come back
 * 409. In particular "confirm return" and "start cleaning" are two separate
 * actions and must stay that way; see laundryActionsFor's comment for why
 * chaining them would quietly destroy the damage-refund window.
 *
 * @param {Object} props
 * @param {Object} props.row - a row from the /api/laundry-orders response
 * @param {Function} props.onAdvanceStatus - ({transactionId, status, damaged, damageNote}) => void
 * @param {boolean} props.advanceInProgress - true while this row's update is in flight
 * @returns {JSX.Element}
 */
const LaundryOrderRow = props => {
  const intl = useIntl();
  const { row, onAdvanceStatus, advanceInProgress } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [damaged, setDamaged] = useState(false);
  const [damageNote, setDamageNote] = useState('');

  const labelKey = statusLabelKey(row);
  const start = formatBookingDate(row.bookingStart, intl);
  const end = formatBookingDate(row.bookingEnd, intl);

  // Only transaction rows have a process state to advance. Inventory-only
  // rows (§8's listings with no booking) move via the readiness endpoint on
  // the Inventory screen instead.
  const action = laundryActionsFor(row)[0] || null;

  // The handover QR. Same single code for both scans - the laundry uses it to
  // hand the garment over and to take it back - so there is one payload here and
  // no notion of "which" QR. It stops being rendered once the return has been
  // confirmed (`isHandoverQrVisibleState`, derived from the row's real process
  // state, never from a metadata flag): from `returned` onwards there is no
  // handover left to scan, and a stale code on the worklist invites a
  // pointless scan that Sharetribe would 409 anyway.
  //
  // Inventory-only rows (§8: an assigned garment with no booking) have no
  // transaction and therefore no handover.
  const qrPayload = handoverQrPayloadFromRecord(row.handoverQr, row.transactionId);
  const showQr = !!qrPayload && isHandoverQrVisibleState(row.state);

  const handleAdvance = () => {
    onAdvanceStatus({
      transactionId: row.transactionId,
      status: action.status,
      ...(action.needsDamageReport ? { damaged, damageNote: damaged ? damageNote : '' } : {}),
    });
  };

  return (
    <>
      <tr className={css.row}>
        {/* Design §11 fixes the QR payload as the raw transaction id. The image
            itself is rendered server-side by /api/transaction-qr. */}
        <td className={css.cellQr}>
          {showQr ? (
            <HandoverQrCode payload={qrPayload} size="small" id={`opsQr-${row.id}`} />
          ) : (
            // Same '—' every other empty cell in this table uses. The expanded
            // detail panel says why it is gone.
            <span className={css.secondaryText}>—</span>
          )}
        </td>
        <td className={css.cellNoWrap}>
          <span className={css.primaryText}>{row.ticketCode || '—'}</span>
          <span className={css.secondaryText}>{row.currentRack || '—'}</span>
        </td>
        <td className={css.cell}>
          <span className={css.primaryText}>{row.customerName || '—'}</span>
          <span className={css.secondaryText}>
            <FormattedMessage
              id="LaundryOpsPage.table.ownerLine"
              values={{ name: row.ownerName || '—' }}
            />
          </span>
        </td>
        <td className={css.cell}>
          <span className={css.primaryText}>{row.title || '—'}</span>
          <span className={css.secondaryText}>
            {[row.brand, row.size].filter(Boolean).join(' · ') || '—'}
          </span>
        </td>
        <td className={css.cellNoWrap}>
          {start || end ? (
            <>
              <span className={css.primaryText}>{start || '—'}</span>
              <span className={css.secondaryText}>{end || '—'}</span>
            </>
          ) : (
            <span className={css.secondaryText}>
              <FormattedMessage id="LaundryOpsPage.table.noBooking" />
            </span>
          )}
        </td>
        <td className={css.cell}>
          {labelKey ? (
            <span className={classNames(css.statusBadge, css[`tone${statusTone(row)}`])}>
              <FormattedMessage id={labelKey} />
            </span>
          ) : (
            '—'
          )}
          {isLate(row) ? (
            <span className={css.flagBadge}>
              <FormattedMessage id="LaundryOpsPage.flag.late" />
            </span>
          ) : null}
          {row.damageReported?.flag ? (
            <span className={css.flagBadge}>
              <FormattedMessage id="LaundryOpsPage.flag.damaged" />
            </span>
          ) : null}
        </td>
        <td className={css.cellNoWrap}>
          <InlineTextButton type="button" onClick={() => setIsOpen(!isOpen)}>
            <FormattedMessage
              id={isOpen ? 'LaundryOpsPage.table.close' : 'LaundryOpsPage.table.open'}
            />
          </InlineTextButton>
        </td>
      </tr>
      {isOpen ? (
        <tr>
          <td className={css.detailCell} colSpan={7}>
            <div className={css.detailPanel}>
              {/* The endpoint denormalizes the listing's first image down to a
                  plain URL, so this is a bare <img> rather than
                  ResponsiveImage (which expects a full image entity with
                  variants). */}
              <div className={css.detailImage}>
                {row.imageUrl ? (
                  <img src={row.imageUrl} alt={row.title || ''} className={css.thumb} />
                ) : (
                  <span className={css.thumbPlaceholder}>
                    <FormattedMessage id="LaundryOpsPage.detail.noImage" />
                  </span>
                )}
              </div>
              <div className={css.detailInfo}>
                {/* The scannable code, big enough to scan off the operator's own
                    screen, with the payload still shown as selectable text
                    underneath (HandoverQrCode showPayload) - a studio whose
                    scanner is down needs to be able to read or copy it. */}
                {showQr ? (
                  <div className={css.detailQr}>
                    <HandoverQrCode
                      payload={qrPayload}
                      size="large"
                      showPayload={true}
                      id={`opsQrDetail-${row.id}`}
                    />
                    <p className={css.detailLine}>
                      <FormattedMessage id="LaundryOpsPage.detail.qrBothHandovers" />
                    </p>
                  </div>
                ) : null}

                {/* No code left to scan - usually because both handovers are
                    done, but also for a cancelled or expired order, so the copy
                    stays state-neutral. The transaction id is still how this
                    order is looked up, so it stays readable. Inventory-only rows
                    have neither. */}
                {!showQr && row.transactionId ? (
                  <>
                    <p className={css.detailLine}>
                      <FormattedMessage id="LaundryOpsPage.detail.qrInactive" />
                    </p>
                    <p className={css.detailLine}>
                      <FormattedMessage
                        id="LaundryOpsPage.detail.qrPayload"
                        values={{ id: row.transactionId }}
                      />
                    </p>
                  </>
                ) : null}
                {row.damageReported?.flag ? (
                  <p className={css.detailDamage}>
                    <FormattedMessage
                      id="LaundryOpsPage.detail.damageNote"
                      values={{ note: row.damageReported.note || '' }}
                    />
                  </p>
                ) : null}

                {action ? (
                  <div className={css.advance}>
                    {action.needsDamageReport ? (
                      <div className={css.damageFields}>
                        <label className={css.damageToggle}>
                          <input
                            type="checkbox"
                            checked={damaged}
                            onChange={e => setDamaged(e.target.checked)}
                          />
                          <FormattedMessage id="LaundryOpsPage.detail.reportDamage" />
                        </label>
                        {damaged ? (
                          <textarea
                            className={css.damageNote}
                            value={damageNote}
                            onChange={e => setDamageNote(e.target.value)}
                            placeholder={intl.formatMessage({
                              id: 'LaundryOpsPage.detail.damageNotePlaceholder',
                            })}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {/* The owner is paid the moment cleaning starts, and
                        Sharetribe has no post-payout refund, so this is the
                        last screen on which a damaged garment can still be
                        cancelled with a refund. Say so. */}
                    {action.firesPayout ? (
                      <p className={css.detailLine}>
                        <FormattedMessage id="LaundryOpsPage.detail.payoutWarning" />
                      </p>
                    ) : null}
                    <PrimaryButton
                      className={css.advanceButton}
                      type="button"
                      inProgress={advanceInProgress}
                      disabled={advanceInProgress}
                      onClick={handleAdvance}
                    >
                      <FormattedMessage id={action.labelKey} />
                    </PrimaryButton>
                  </div>
                ) : (
                  <p className={css.detailLine}>
                    <FormattedMessage id="LaundryOpsPage.detail.noAdvance" />
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};

export default LaundryOrderRow;
