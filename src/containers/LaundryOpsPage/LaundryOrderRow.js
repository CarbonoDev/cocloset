import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { laundryActionsFor, statusLabelKey } from '../../util/laundryStatuses';
import { isLate } from './LaundryOpsPage.helpers';
import { InlineTextButton, PrimaryButton } from '../../components';

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
        {/* Design §11 fixes the QR payload as the raw transaction id. No QR
            rendering library is bundled in this template, so the payload is
            shown as text rather than pulling in a new dependency. */}
        <td className={css.cellQr}>
          <span className={css.qrPlaceholder} title={row.transactionId || ''}>
            <FormattedMessage id="LaundryOpsPage.table.qrPlaceholder" />
          </span>
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
                <p className={css.detailLine}>
                  <FormattedMessage
                    id="LaundryOpsPage.detail.qrPayload"
                    values={{ id: row.transactionId || '—' }}
                  />
                </p>
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
