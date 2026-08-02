import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import {
  nextLaundryStatus,
  statusLabelKey,
  DAMAGE_REPORT_STATUS,
} from '../../util/laundryStatuses';
import { InlineTextButton, PrimaryButton } from '../../components';

import { statusTone } from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

const formatBookingDate = (isoString, intl) =>
  isoString
    ? intl.formatDate(new Date(isoString), { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

/**
 * One row of the laundry ops orders table (mockups 05-08.jpg), plus the
 * expandable detail panel that carries the status-advance action.
 *
 * The advance action deliberately offers exactly ONE target - the immediate
 * next status from `nextLaundryStatus` - because the server rejects any other
 * move with a 409. Offering a dropdown of all statuses here would just build a
 * UI for requests that always fail.
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

  // Only transaction rows have a laundry status to advance. Inventory-only
  // rows (§8's listings with no booking) move via the readiness endpoint on
  // the Inventory screen instead.
  const nextStatus = row.rowType === 'transaction' ? nextLaundryStatus(row.laundryStatus) : null;
  const isDamageStep = nextStatus === DAMAGE_REPORT_STATUS;

  const handleAdvance = () => {
    onAdvanceStatus({
      transactionId: row.transactionId,
      status: nextStatus,
      ...(isDamageStep ? { damaged, damageNote: damaged ? damageNote : '' } : {}),
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
          {row.lateReturn ? (
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

                {nextStatus ? (
                  <div className={css.advance}>
                    {isDamageStep ? (
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
                    <PrimaryButton
                      className={css.advanceButton}
                      type="button"
                      inProgress={advanceInProgress}
                      disabled={advanceInProgress}
                      onClick={handleAdvance}
                    >
                      <FormattedMessage
                        id="LaundryOpsPage.detail.advanceTo"
                        values={{
                          status: intl.formatMessage({
                            id: `LaundryOpsPage.status.${nextStatus}`,
                          }),
                        }}
                      />
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
