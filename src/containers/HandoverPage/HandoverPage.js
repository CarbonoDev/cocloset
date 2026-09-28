import React, { useEffect, useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import {
  HANDOVER_COUNTERPARTY_CUSTOMER,
  HANDOVER_COUNTERPARTY_PROVIDER,
  handoverStepMessageId,
} from '../../util/handoverSteps';
import { MAX_LAUNDRY_CODE_LENGTH } from '../../util/laundryStatuses';
import { getBookingOverdueDays } from '../../util/dates';

import { isScrollingDisabled, manageDisableScrolling } from '../../ducks/ui.duck';

import {
  H3,
  HandBackToOwnerButton,
  Page,
  PrimaryButton,
  LayoutSingleColumn,
  NamedLink,
} from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import { confirmHandover, handBackToOwner } from './HandoverPage.duck';
import css from './HandoverPage.module.css';

/**
 * THE PAGE A SCANNED HANDOVER QR OPENS.
 *
 *   > "al escanear debe llevar al paso siguiente con un button para confirmar y avanzar"
 *   > "El qr solo debe poder leerse si eres laundry, si otro actor lo lee solo debe mostrarle
 *   >  indicaciones"
 *
 * One screen, three audiences, and the difference between them is ONE button:
 *
 *   - the assigned LAUNDRY sees the step and a confirm button;
 *   - the CUSTOMER and the PROVIDER see the same step, described as what they have to do or
 *     wait for, and no button;
 *   - anyone else never gets here - /api/handover-status answers 403 and the page says so.
 *
 * `canConfirm` comes from the SERVER, and this component does not second-guess it. Deriving
 * "am I the laundry" in the browser would put the rule in two places, and the browser's copy
 * is the one an attacker can edit. The button is a convenience on top of an authorization
 * that `server/api-util/laundryAuth.js` performs again on the write itself.
 */

const DATE_FORMAT = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };

/**
 * The customer's last day, from the API's exclusive booking end.
 *
 * Same convention as `LineItemBookingPeriod` for `line-item/day`, so the date here and the
 * date in the order breakdown are the same date. Whole-day arithmetic on the instant is
 * enough: both ends are midnights in the listing's zone.
 */
const inclusiveEnd = isoEnd => new Date(new Date(isoEnd).getTime() - 24 * 60 * 60 * 1000);

const CounterpartyLine = props => {
  const { step } = props;
  if (!step) {
    return null;
  }

  const id =
    step.counterparty === HANDOVER_COUNTERPARTY_PROVIDER
      ? 'HandoverPage.counterparty.provider'
      : 'HandoverPage.counterparty.customer';

  return (
    <p className={css.counterparty}>
      <FormattedMessage id={id} />
    </p>
  );
};

/**
 * What the viewer is told, when they cannot act.
 *
 * The message depends on BOTH the step and who is reading, because "wait for the studio to
 * finish" and "take the garment to the studio" are the same step seen from two sides. A
 * single "please wait" would be wrong for whichever of them is actually holding the garment.
 */
const instructionMessageId = (step, viewerRole) => {
  if (!step) {
    return 'HandoverPage.instruction.nothingDue';
  }
  const isMyTurn =
    (viewerRole === 'customer' && step.counterparty === HANDOVER_COUNTERPARTY_CUSTOMER) ||
    (viewerRole === 'provider' && step.counterparty === HANDOVER_COUNTERPARTY_PROVIDER);

  return isMyTurn
    ? handoverStepMessageId(step, 'yourTurn')
    : handoverStepMessageId(step, 'waiting');
};

/**
 * Title for the step, in the laundry's own words when there are some.
 *
 * The studio reads the step as work to do ("Process this garment for cleaning:") while the
 * counterparties read it as an event at the counter; only some steps have that second
 * wording, so the shared title is the fallback rather than a missing-key crash.
 */
const stepTitleMessageId = (step, viewerRole, intl) => {
  const titleId = handoverStepMessageId(step, 'title');
  const laundryId = `${titleId}.laundry`;
  return viewerRole === 'laundry' && intl.messages[laundryId] ? laundryId : titleId;
};

export const HandoverPageComponent = props => {
  const intl = useIntl();
  const {
    scrollingDisabled,
    handover,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
    onConfirm,
    handBackInProgress,
    handBackError,
    onHandBack,
    onManageDisableScrolling,
  } = props;

  // How long the studio will need to clean this garment, asked for at the moment it comes
  // back over the counter.
  //
  //   > "al momento de recibir la prenda, laundry puede seleccionar cuantos dias necesita
  //   >  para lavar, pero en mobile no aparece esta opción, estos días deben tener un default
  //   >  de los días que indique la laundry, pero pueden modificarse al recibir"
  //
  // The desktop ops table has had this box; this page - the one a studio actually uses on a
  // phone, because it is what a scan opens - did not, so a return confirmed from a phone
  // silently fell back to the configured turnaround with nothing on screen to say so.
  //
  // WHETHER TO ASK AT ALL IS THE SERVER'S ANSWER, not a state check here: the endpoint sends
  // `defaultCleaningDays` only for the laundry, and only at the step that consumes it. One
  // place decides, and it is the same place that decides whether there is a button.
  const [cleaningDays, setCleaningDays] = useState('');
  // Pre-filled with whatever this garment already carries, so a studio re-confirming a step
  // is not asked to remember its own code.
  const [codeInput, setCodeInput] = useState('');
  const defaultCleaningDays = handover?.defaultCleaningDays;
  // How many days there is actually room for before this garment's next rental, and the date
  // that causes it. Absent when nothing is booked next, or when the lookup failed - in either
  // case there is no ceiling to show and the field behaves as it always did. The server
  // clamps regardless; this is what stops a studio typing 4 and silently getting 2.
  // The studio's own code for this garment, and whether this step is the one that asks for
  // it. Both decided by the server: see server/api-util/laundryCode.js.
  const laundryCode = handover?.laundryCode;
  const takesLaundryCode = handover?.takesLaundryCode === true;
  const maxCleaningDays = handover?.maxCleaningDays;
  const nextBookingStart = handover?.nextBookingStart;
  const hasCleaningCeiling = Number.isInteger(maxCleaningDays);

  // The damage report, at the same moment.
  //
  //   > "cuando esta el form en que ingreso esos días, ya sea que venga de qr, o no, no me
  //   >  aparece la opción para reportar daños"
  //
  // The desktop worklist has had this; this page never did, so a studio taking a garment back
  // from a phone had no way to record damage at the one moment it is physically inspected -
  // and by the next step the payout has fired and a cancel-with-refund is no longer
  // expressible. Whether to ask is the SERVER's answer, same as the days box.
  const [damaged, setDamaged] = useState(false);
  const [damageNote, setDamageNote] = useState('');
  const takesDamageReport = handover?.takesDamageReport === true;

  useEffect(() => {
    // Seeded from the server's answer, and re-seeded when it changes (the page refetches
    // after every confirm). An empty string until it arrives, so the field is never a
    // controlled input flipping to uncontrolled.
    // Pre-filled with what the studio can actually have: its own turnaround, or the ceiling
    // when the calendar leaves less room than that. Pre-filling the larger number and letting
    // the server quietly cut it down is exactly the silence the client asked to remove.
    const suggested =
      Number.isInteger(defaultCleaningDays) && Number.isInteger(maxCleaningDays)
        ? Math.min(defaultCleaningDays, maxCleaningDays)
        : defaultCleaningDays;
    setCleaningDays(Number.isInteger(suggested) ? String(suggested) : '');
  }, [defaultCleaningDays, maxCleaningDays]);

  useEffect(() => {
    setCodeInput(typeof laundryCode === 'string' ? laundryCode : '');
  }, [laundryCode]);

  const title = intl.formatMessage({ id: 'HandoverPage.title' });

  const body = (() => {
    if (fetchInProgress) {
      return (
        <p className={css.status}>
          <FormattedMessage id="HandoverPage.loading" />
        </p>
      );
    }

    if (fetchError) {
      // 403 is by far the most likely: someone scanned a code for a rental they have nothing
      // to do with. It gets its own sentence, because "you are not part of this rental" and
      // "something went wrong" send the reader to do different things.
      const isForbidden = fetchError?.status === 403;
      const isUnauthorized = fetchError?.status === 401;
      const errorId = isForbidden
        ? 'HandoverPage.error.forbidden'
        : isUnauthorized
        ? 'HandoverPage.error.unauthorized'
        : 'HandoverPage.error.generic';

      return (
        <div className={css.errorBlock}>
          <p className={css.error}>
            <FormattedMessage id={errorId} />
          </p>
          {isUnauthorized ? (
            <NamedLink name="LoginPage" className={css.link}>
              <FormattedMessage id="HandoverPage.error.signIn" />
            </NamedLink>
          ) : null}
        </div>
      );
    }

    // NEVER RENDER NOTHING. This branch used to `return null`, and a duck bug that stored
    // `undefined` instead of the handover turned the whole page into a heading over empty
    // space - no data, no error, nothing to report. A page with no answer still owes the
    // reader a sentence.
    if (!handover) {
      return (
        <p className={css.error}>
          <FormattedMessage id="HandoverPage.error.generic" />
        </p>
      );
    }

    const {
      step,
      viewerRole,
      canConfirm,
      action,
      canHandBack,
      listingId,
      processState,
      listingTitle,
      ticketCode,
      bookingStart,
      bookingEnd,
    } = handover;

    const daysOverdue = getBookingOverdueDays(bookingEnd);

    return (
      <div className={css.card}>
        {listingTitle ? <p className={css.garment}>{listingTitle}</p> : null}

        {/* THE CURRENT STATUS, stated outright.
              > "si soy un actor, debo poder ver la información completa del status actual"
            The step below says what happens NEXT; this says where the rental IS. They are
            different questions, and a page that only answered the second one left a customer
            unable to tell whether their garment had been dropped off yet. */}
        <dl className={css.facts}>
          {processState ? (
            <div className={css.fact}>
              <dt className={css.factLabel}>
                <FormattedMessage id="HandoverPage.fact.status" />
              </dt>
              <dd className={css.factValue}>
                <FormattedMessage id={`HandoverPage.status.${processState}`} />
              </dd>
            </div>
          ) : null}

          {bookingStart && bookingEnd ? (
            <div className={css.fact}>
              <dt className={css.factLabel}>
                <FormattedMessage id="HandoverPage.fact.rental" />
              </dt>
              <dd className={css.factValue}>
                <FormattedMessage
                  id="HandoverPage.fact.rentalRange"
                  values={{
                    startDate: intl.formatDate(new Date(bookingStart), DATE_FORMAT),
                    // The API's end is EXCLUSIVE; the customer's last day is the one before.
                    // Same convention as LineItemBookingPeriod, so the two screens agree.
                    endDate: intl.formatDate(inclusiveEnd(bookingEnd), DATE_FORMAT),
                  }}
                />
              </dd>
            </div>
          ) : null}

          {ticketCode ? (
            <div className={css.fact}>
              <dt className={css.factLabel}>
                <FormattedMessage id="HandoverPage.fact.ticket" />
              </dt>
              <dd className={css.factValue}>
                <span className={css.ticketCode}>{ticketCode}</span>
              </dd>
            </div>
          ) : null}

          <div className={css.fact}>
            <dt className={css.factLabel}>
              <FormattedMessage id="HandoverPage.fact.yourRole" />
            </dt>
            <dd className={css.factValue}>
              <FormattedMessage id={`HandoverPage.role.${viewerRole}`} />
            </dd>
          </div>
        </dl>

        {step ? (
          <>
            <H3 as="h2" className={css.stepTitle}>
              <FormattedMessage id={stepTitleMessageId(step, viewerRole, intl)} />
            </H3>
            <CounterpartyLine step={step} />
            {step.isLate ? (
              <p className={css.late}>
                <FormattedMessage id="HandoverPage.lateReturn" />
              </p>
            ) : null}
          </>
        ) : (
          <H3 as="h2" className={css.stepTitle}>
            {/* NOT ALWAYS "nothing to do". The cleaning phases are studio-internal work with
                nobody at the counter, so they have no step - but the studio standing in its
                own shop with the garment in its hands very much has something to do, and this
                page told it otherwise. */}
            <FormattedMessage
              id={
                processState === 'initial-cleaning' && viewerRole === 'laundry'
                  ? 'HandoverPage.cleaningInProgress.title'
                  : action
                  ? `HandoverPage.status.${processState}`
                  : 'HandoverPage.nothingDue.title'
              }
            />
          </H3>
        )}

        {processState === 'initial-cleaning' && viewerRole === 'laundry' ? (
          <p className={css.instruction}>
            <FormattedMessage id="HandoverPage.cleaningInProgress.instruction" />
          </p>
        ) : null}

        {canConfirm ? (
          <>
            {step && step.status !== 'garment-received' ? (
              <p className={css.instruction}>
                <FormattedMessage id={handoverStepMessageId(step, 'laundry')} />
              </p>
            ) : null}

            {takesDamageReport ? (
              <div className={css.damageField}>
                <label className={css.damageCheckboxLabel} htmlFor="handoverDamaged">
                  <input
                    id="handoverDamaged"
                    type="checkbox"
                    checked={damaged}
                    onChange={e => setDamaged(e.target.checked)}
                  />
                  <span>
                    <FormattedMessage id="HandoverPage.damage.label" />
                  </span>
                </label>
                {damaged ? (
                  <textarea
                    className={css.damageNote}
                    value={damageNote}
                    onChange={e => setDamageNote(e.target.value)}
                    placeholder={intl.formatMessage({ id: 'HandoverPage.damage.notePlaceholder' })}
                    rows={3}
                  />
                ) : null}
              </div>
            ) : null}

            {/* THE STUDIO'S OWN CODE, asked for at the one step where the garment is
                physically on the counter coming IN from its owner.
                  > "cuando laundry recibe la prenda desde el provider, debe aparecer un input
                  >  para que laundry pueda ingresar un código interno para esa prenda" */}
            {takesLaundryCode ? (
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
                  <label className={css.cleaningDaysLabel} htmlFor="handoverLaundryCode">
                    <FormattedMessage id="HandoverPage.laundryCode.label" />
                  </label>
                  <input
                    id="handoverLaundryCode"
                    className={css.cleaningDaysInput}
                    type="text"
                    maxLength={MAX_LAUNDRY_CODE_LENGTH}
                    value={codeInput}
                    onChange={e => setCodeInput(e.target.value)}
                  />
                  <p className={css.cleaningDaysHelp}>
                    <FormattedMessage id="HandoverPage.laundryCode.help" />
                  </p>
                </div>
              </div>
            ) : null}

            {Number.isInteger(defaultCleaningDays) ? (
              <div className={css.cleaningDaysField}>
                <label className={css.cleaningDaysLabel} htmlFor="handoverCleaningDays">
                  <FormattedMessage id="HandoverPage.cleaningDays.label" />
                </label>
                <input
                  id="handoverCleaningDays"
                  className={css.cleaningDaysInput}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={cleaningDays}
                  {...(hasCleaningCeiling ? { max: String(maxCleaningDays) } : {})}
                  onChange={e => setCleaningDays(e.target.value)}
                />
                <p className={css.cleaningDaysHelp}>
                  <FormattedMessage
                    id="HandoverPage.cleaningDays.help"
                    values={{ days: defaultCleaningDays }}
                  />
                </p>
                {/* The reason, not just the number. "You have 2 days" is an instruction;
                    "it is booked again on the 29th" is why - and it is the thing the studio
                    can act on, by calling somebody. */}
                {hasCleaningCeiling ? (
                  <p className={css.cleaningDaysLimit}>
                    <FormattedMessage
                      id="HandoverPage.cleaningDays.nextBooking"
                      values={{
                        days: maxCleaningDays,
                        date: intl.formatDate(new Date(nextBookingStart), {
                          day: 'numeric',
                          month: 'short',
                        }),
                      }}
                    />
                  </p>
                ) : null}
              </div>
            ) : null}
            {/* Shown to all three roles, at every step, once the garment has one.
                  > "ese código se le debe mostrar a todas las partes de la transacción" */}
            {laundryCode ? (
              <p className={css.laundryCodeLine}>
                <FormattedMessage
                  id="HandoverPage.laundryCode.value"
                  values={{ code: laundryCode }}
                />
              </p>
            ) : null}
            {confirmError ? (
              <p className={css.error}>
                <FormattedMessage id="HandoverPage.error.confirmFailed" />
              </p>
            ) : null}
            {processState === 'initial-cleaning' ? (
              <NamedLink name="LaundryOpsDashboardPage" className={css.dashboardButton}>
                <FormattedMessage id="HandoverPage.goToDashboard" />
              </NamedLink>
            ) : (
              <PrimaryButton
                className={css.confirmButton}
                type="button"
                inProgress={confirmInProgress}
                disabled={confirmInProgress}
                onClick={() =>
                  onConfirm({
                    transactionId: handover.transactionId,
                    status: action.status,
                    // Only sent when this step takes it AND the box holds a usable whole
                    // number. A blank box is NOT a zero: the server reads "absent" as "apply
                    // the configured turnaround", while 0 means "ready today" and would block
                    // nothing at all.
                    // Clamped here as well as on the server. Not belt-and-braces for its own
                    // sake: a browser's `max` is advisory on a typed value, and posting 4 to be
                    // silently stored as 2 is the behaviour this change exists to remove.
                    ...(Number.isInteger(defaultCleaningDays) && /^\d+$/.test(cleaningDays.trim())
                      ? {
                          cleaningDays: hasCleaningCeiling
                            ? Math.min(Number.parseInt(cleaningDays, 10), maxCleaningDays)
                            : Number.parseInt(cleaningDays, 10),
                        }
                      : {}),
                    // Only at the step that takes it, and only when something was typed. A
                    // blank box is "not decided yet" rather than "clear the code": the server
                    // reads an absent value as "leave it alone", so a studio confirming a step
                    // without touching the field cannot wipe a code it set earlier.
                    ...(takesLaundryCode && codeInput.trim() !== ''
                      ? { laundryCode: codeInput.trim() }
                      : {}),
                    // The note only travels when damage was actually reported: a note left
                    // behind after un-ticking the box would attach a description of damage to a
                    // garment recorded as fine.
                    ...(takesDamageReport
                      ? { damaged, damageNote: damaged ? damageNote : '' }
                      : {}),
                  })
                }
              >
                {/* THE SAME LABEL THE OPS TABLE PRINTS.
                    > "el handover tiene que funcionar igual que en la pestaña orders de
                    >  laundry" (Jonathan, 2026-09-08)

                  Keyed on the ACTION, not the step, because the two do not always coincide:
                  the cleaning phases have no counter event at all, and the page used to offer
                  nothing there. `step` is still what names the counter above. */}
                <FormattedMessage
                  id={
                    step
                      ? handoverStepMessageId(step, 'confirm')
                      : `LaundryOpsPage.action.${action.status}`
                  }
                />
              </PrimaryButton>
            )}
          </>
        ) : (
          <p className={css.instruction}>
            <FormattedMessage id={instructionMessageId(step, viewerRole)} />
          </p>
        )}

        {daysOverdue > 0 &&
          ['picked-up', 'overdue'].includes(processState) &&
          ['laundry', 'customer'].includes(viewerRole) ? (
            <p className={css.warning}>
              <FormattedMessage
                id={
                  viewerRole === 'laundry'
                    ? 'HandoverPage.laundryDeliveryOverdue'
                    : 'HandoverPage.customerDeliveryOverdue'
                }
                values={{ daysOverdue }}
              />
            </p>
          ) : null}
        {/* HANDING THE GARMENT BACK TO ITS OWNER.
              > "el botón para devolver la prenda en el lado de laundry debe aparecer en
              >  order, handover o inventory" (Jonathan, 2026-09-07)

            A SIBLING of the confirm block, not a branch of it, because the two answer
            different questions and both can be true. `canConfirm` is about the rental; this
            is about the garment, and the case that put it here is a rental that ended -
            cancelled, or finished - with the garment still on the shelf. That is exactly when
            there is no step to confirm and the page would otherwise be a dead end.

            `canHandBack` is the SERVER's answer, on the same terms as `canConfirm`: this
            component does not re-derive who may write custody. */}
        {canHandBack && listingId ? (
          <div className={css.handBack}>
            <p className={css.instruction}>
              <FormattedMessage id="HandoverPage.handBack.hint" />
            </p>
            {handBackError ? (
              <p className={css.error}>
                <FormattedMessage
                  id={
                    handBackError?.status === 409
                      ? 'HandoverPage.handBack.activeRental'
                      : 'HandoverPage.handBack.failed'
                  }
                />
              </p>
            ) : null}
            <HandBackToOwnerButton
              id="HandoverPage.handBack"
              className={css.handBackTrigger}
              garmentTitle={listingTitle}
              inProgress={handBackInProgress}
              onManageDisableScrolling={onManageDisableScrolling}
              onConfirm={() => onHandBack({ transactionId: handover.transactionId, listingId })}
            />
          </div>
        ) : null}
      </div>
    );
  })();

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="HandoverPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <H3 as="h1" className={css.heading}>
            <FormattedMessage id="HandoverPage.heading" />
          </H3>
          {body}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const {
    handover,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
    handBackInProgress,
    handBackError,
  } = state.HandoverPage;

  return {
    scrollingDisabled: isScrollingDisabled(state),
    handover,
    fetchInProgress,
    fetchError,
    confirmInProgress,
    confirmError,
    handBackInProgress,
    handBackError,
  };
};

const mapDispatchToProps = dispatch => ({
  onConfirm: params => dispatch(confirmHandover(params)),
  onHandBack: params => dispatch(handBackToOwner(params)),
  onManageDisableScrolling: (componentId, disableScrolling) =>
    dispatch(manageDisableScrolling(componentId, disableScrolling)),
});

const HandoverPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(HandoverPageComponent);

export default HandoverPage;
