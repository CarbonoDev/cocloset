import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import {
  MAX_LAUNDRY_CODE_LENGTH,
  canHandBackToOwner,
  laundryActionsFor,
  statusLabelKey,
} from '../../util/laundryStatuses';
import { isLate } from './LaundryOpsPage.helpers';
import { HandBackToOwnerButton, InlineTextButton, PrimaryButton } from '../../components';

import { statusTone } from './LaundryOpsPage.helpers';
import css from './LaundryOpsPage.module.css';

const formatBookingDate = (isoString, intl) =>
  isoString
    ? intl.formatDate(new Date(isoString), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null;

const lastBookedDayIso = isoString => {
  if (!isoString) return null;
  const d = new Date(isoString);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
};

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
 * @param {Function} [props.onHandBackToOwner] - ({listingId}) => void
 * @param {boolean} [props.handBackInProgress] - true while this garment's hand-back is in flight
 * @param {Function} [props.onManageDisableScrolling] - modal scroll lock, for the confirm dialog
 * @returns {JSX.Element}
 */
const LaundryOrderRow = props => {
  const intl = useIntl();
  const {
    row,
    onAdvanceStatus,
    advanceInProgress,
    onHandBackToOwner,
    handBackInProgress,
    onManageDisableScrolling,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [damaged, setDamaged] = useState(false);
  const [damageNote, setDamageNote] = useState('');
  // How many days cleaning will take, collected at the return step. Held as a
  // STRING and started empty on purpose: empty means "use the turnaround this
  // studio configured for this category", which the server resolves. Pre-filling
  // a number here would mean guessing that turnaround client-side, and would turn
  // the studio's configured default into a value the client had asserted.
  // Pre-filled with the turnaround this studio configured for the garment's category, from
  // the endpoint (`row.defaultCleaningDays`).
  //
  //   > "estos días deben tener un default de los días que indique la laundry, pero pueden
  //   >  modificarse al recibir"
  //
  // It used to start blank, with "leave it blank to use your configured turnaround"
  // underneath - which asked the operator to accept a number they could not see, and to know
  // their own configuration by heart to judge whether it fitted this garment.
  const [cleaningDays, setCleaningDays] = useState(
    Number.isInteger(row?.defaultCleaningDays) ? String(row.defaultCleaningDays) : ''
  );

  // THE STUDIO'S OWN CODE FOR THIS GARMENT, asked for at the reception step.
  //
  //   > "handover/... está en etapa de recibir una prenda y puedo ingresar el numero de
  //   >  internal code, pero no es visible este input en laundry/orders"
  //
  // The phone page has always asked for it; this table never did. Both post to the same
  // endpoint, and that endpoint has always ACCEPTED `laundryCode` - so a reception done from
  // a desk simply never sent one, and the garment went onto a shelf with no name, silently.
  //
  // Pre-filled from the row, so a studio re-confirming a step is not asked to remember its own
  // shelving: the transaction's code if this rental has one, otherwise the listing's current
  // code, which is what a garment this studio has held before already carries. Resolved
  // server-side - see server/api/laundry-orders.js - because deciding whether a stored code is
  // still live means comparing its issuer against the current assignment.
  const [laundryCode, setLaundryCode] = useState(
    typeof row?.laundryCode === 'string' ? row.laundryCode : ''
  );

  const labelKey = statusLabelKey(row);
  const start = formatBookingDate(row.bookingStart, intl);
  const end = formatBookingDate(lastBookedDayIso(row.bookingEnd), intl);

  // Only transaction rows have a process state to advance. Inventory-only
  // rows (§8's listings with no booking) move via the readiness endpoint on
  // the Inventory screen instead.
  const action = laundryActionsFor(row)[0] || null;

  // A row with no `listingId` cannot be handed back whatever its state says - there is
  // nothing to write to. `onHandBackToOwner` is optional so this row stays renderable in
  // contexts that do not wire the custody write.
  const showHandBack = !!onHandBackToOwner && !!row.listingId && canHandBackToOwner(row);

  // NO QR ON THE LAUNDRY'S SCREENS.
  //
  //   > "podemos quitar el QR para los laundries? solamente un provider o un customer pueden
  //   >  ver el QR, laundry solo va a escanear"
  //
  // The code belongs to the two people who carry it. A studio rendering its own copy of a
  // customer's code can advance a handover without anyone being at the counter, which is
  // exactly the attestation the scan is supposed to be. The studio scans what the person in
  // front of them is holding, and the scan opens /handover/<id> with the right transaction
  // and the right action already resolved.
  //
  // The transaction id is still shown in the detail panel: a studio whose scanner is down
  // needs something to type into the search box, and that has always been the id rather than
  // the code.
  //
  // Rows share a table, so the input's id has to be per-row or every label in the
  // table would point at the first one.
  const cleaningDaysInputId = `LaundryOrderRow.cleaningDays.${row.id}`;
  const laundryCodeInputId = `LaundryOrderRow.laundryCode.${row.id}`;
  // Same reason: `aria-controls` on the toggle has to name THIS row's detail.
  const detailRowId = `LaundryOrderRow.detail.${row.id}`;

  const toggleOpen = () => setIsOpen(open => !open);

  // Only send cleaningDays when it is a usable non-negative integer. A blank box
  // is not a zero: the server treats "absent" as "apply the configured
  // turnaround", and sending 0 would mean "it is ready today" - which would
  // block nothing at all.
  const parsedCleaningDays = Number.parseInt(cleaningDays, 10);
  const hasCleaningDays =
    cleaningDays !== '' && Number.isInteger(parsedCleaningDays) && parsedCleaningDays >= 0;

  // A blank box is "not decided yet", never a delete: the server treats an empty string as
  // "not given" and leaves whatever is stored alone, which is what lets a studio advance a
  // garment it has not named yet without wiping the name it had.
  const trimmedLaundryCode = laundryCode.trim();

  const handleAdvance = () => {
    onAdvanceStatus({
      transactionId: row.transactionId,
      status: action.status,
      ...(action.needsDamageReport ? { damaged, damageNote: damaged ? damageNote : '' } : {}),
      ...(action.needsCleaningDays && hasCleaningDays ? { cleaningDays: parsedCleaningDays } : {}),
      ...(action.needsLaundryCode && trimmedLaundryCode ? { laundryCode: trimmedLaundryCode } : {}),
    });
  };

  return (
    <>
      {/* THE WHOLE SUMMARY ROW TOGGLES, AND ONLY THE SUMMARY ROW.
            > "podrías hacer que todo el row sea clickeable? solo el row, ya que al abrir, se
            >  abre el content de cada fila y no deberiamos poder dar click a toda esa area"

          The handler sits on this <tr> alone. The detail <tr> below is a sibling, not a child,
          so the panel an operator is typing cleaning days into never collapses under its own
          click - which is the distinction the client drew, and which a single wrapper around
          both rows would have lost.

          No `tabIndex` or `role="button"` here on purpose: the Open/Close button stays, and it
          is what carries keyboard access and the expanded state. Making the row focusable too
          would put two tab stops on one control and announce the row's entire contents as the
          button's name. So the row is a pointer affordance over a real control, not a
          replacement for one - and `.row`'s existing hover already says it is live. */}
      <tr className={css.row} onClick={toggleOpen}>
        <td className={css.cellNoWrap}>
          {/* THE STUDIO'S OWN CODE FIRST.
                > "en la tabla de orders como laundry, debo poder ver el ticket que asigné a
                >  la prenda, no el ticket de la transaction en la columna TICKET (...) el
                >  ticket interno de la transaction se debe mostrar solo como fallback"
                >   (Jonathan, 2026-09-08)

              This column is what an operator reads to go and find a garment, and only one of
              the two codes answers that: `laundryCode` is what this studio wrote on it and
              where it sits on their shelving. `ticketCode` identifies the rental - useful
              when nothing has been named yet, useless for finding a coat. Same order the
              inventory grid already uses. */}
          <span className={css.primaryText}>{row.laundryCode || row.ticketCode || '—'}</span>
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
          {/* `stopPropagation` because this click would otherwise bubble to the <tr> above and
              toggle a second time, leaving the label looking dead. Explicit here rather than
              dropping the button's own handler and letting it bubble: the button must keep
              working on its own terms if the row's handler is ever moved or removed. */}
          <InlineTextButton
            type="button"
            aria-expanded={isOpen}
            aria-controls={detailRowId}
            onClick={e => {
              e.stopPropagation();
              toggleOpen();
            }}
          >
            <FormattedMessage
              id={isOpen ? 'LaundryOpsPage.table.close' : 'LaundryOpsPage.table.open'}
            />
          </InlineTextButton>
        </td>
      </tr>
      {isOpen ? (
        <tr id={detailRowId}>
          <td className={css.detailCell} colSpan={6}>
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
                {/* The transaction id, as selectable text. This is what a studio types into
                    the search box when the scanner is down - it is not a code to be scanned
                    off the operator's own screen, which is the point of removing the QR from
                    here. Inventory-only rows (an assigned garment with no booking) have no
                    transaction and so no id. */}
                {row.transactionId ? (
                  <p className={css.detailLine}>
                    <FormattedMessage
                      id="LaundryOpsPage.detail.transactionId"
                      values={{ id: row.transactionId }}
                    />
                  </p>
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
                    {/* Same box, same step and the same copy as HandoverPage: a studio that
                        does half its receptions at the counter and half at the desk must not
                        be asked two different questions about the same garment. */}
                    {action.needsLaundryCode ? (
                      <div className={css.cleaningCodeContainer}>
                        <div className={css.cleaningCodeSteps}>
                          <p className={css.cleaningCodeStep}>
                            <FormattedMessage
                              id="HandoverPage.laundryCode.step1"
                              values={{ b: chunks => <b>{chunks}</b> }}
                            />
                          </p>
                          <p className={css.cleaningCodeStep}>
                            <FormattedMessage
                              id="HandoverPage.laundryCode.step2"
                              values={{ b: chunks => <b>{chunks}</b> }}
                            />
                          </p>
                        </div>
                        <div className={css.cleaningDaysField}>
                          <label className={css.cleaningDaysLabel} htmlFor={laundryCodeInputId}>
                            <FormattedMessage id="HandoverPage.laundryCode.label" />
                          </label>
                          <input
                            id={laundryCodeInputId}
                            className={css.cleaningDaysInput}
                            type="text"
                            maxLength={MAX_LAUNDRY_CODE_LENGTH}
                            value={laundryCode}
                            onChange={e => setLaundryCode(e.target.value)}
                          />
                          <span className={css.cleaningDaysHint}>
                            <FormattedMessage id="HandoverPage.laundryCode.help" />
                          </span>
                        </div>
                      </div>
                    ) : null}
                    {action.needsCleaningDays ? (
                      <div className={css.cleaningDaysField}>
                        <label className={css.cleaningDaysLabel} htmlFor={cleaningDaysInputId}>
                          <FormattedMessage id="LaundryOpsPage.detail.cleaningDays" />
                        </label>
                        <input
                          id={cleaningDaysInputId}
                          className={css.cleaningDaysInput}
                          type="number"
                          min="0"
                          step="1"
                          value={cleaningDays}
                          onChange={e => setCleaningDays(e.target.value)}
                          placeholder={intl.formatMessage({
                            id: 'LaundryOpsPage.detail.cleaningDaysPlaceholder',
                          })}
                        />
                        {/* Says what leaving it blank does, so the studio's own
                            configured turnaround is a visible default rather than
                            invisible behaviour. */}
                        <span className={css.cleaningDaysHint}>
                          <FormattedMessage id="LaundryOpsPage.detail.cleaningDaysHint" />
                        </span>
                      </div>
                    ) : null}
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
                ) : showHandBack ? null : (
                  <p className={css.detailLine}>
                    <FormattedMessage id="LaundryOpsPage.detail.noAdvance" />
                  </p>
                )}

                {/* HANDING IT BACK, FROM THE WORKLIST TOO.
                      > "el botón para devolver la prenda en el lado de laundry debe aparecer
                      >  en order, handover o inventory" (Jonathan, 2026-09-07)

                    The same button as the inventory card and the counter phone, with the same
                    label and the same write. A studio that has the rental open in front of it
                    - which is where a cancellation is read about - should not have to go and
                    find the garment on another screen to release it. */}
                {showHandBack ? (
                  <div className={css.advance}>
                    <p className={css.detailLine}>
                      <FormattedMessage id="LaundryOpsPage.detail.handBackHint" />
                    </p>
                    <HandBackToOwnerButton
                      id={`LaundryOrderRow.handBack.${row.id}`}
                      className={css.handBackButton}
                      garmentTitle={row.title}
                      inProgress={handBackInProgress}
                      onManageDisableScrolling={onManageDisableScrolling}
                      onConfirm={() => onHandBackToOwner({ listingId: row.listingId })}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};

export default LaundryOrderRow;
