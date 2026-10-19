'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { ArrivalSourceFields } from '../arrival-source';
import { AUDIT_FORM_COPY } from '../copy';
import { BLANK_AUDIT_REQUEST_STATE } from './action-state';
import { requestAuditAction } from './actions';
import { FieldError } from './field-error';

/**
 * The public audit request form (D-10, D-19, UI-SPEC C-8/C-9).
 *
 * ── IT WORKS WITH JAVASCRIPT OFF ────────────────────────────────────────────
 *
 * `method="post"` and `encType="multipart/form-data"` are on the element rather
 * than left to React: with JS disabled the browser does a native submit, and
 * the default `application/x-www-form-urlencoded` drops file parts — which the
 * optional CSV field (09-03) needs. React 19's `useActionState` then re-renders
 * with the returned state when JS IS on, and the action's `redirect` yields a
 * 303 either way. One code path, two runtimes.
 *
 * `noValidate` so the browser's own constraint messages never appear: with them
 * on, a JS-enabled visitor reads Chrome's wording and a JS-disabled one reads
 * ours, and only ours is the sentence somebody wrote for this form.
 *
 * ── NO `useState` ───────────────────────────────────────────────────────────
 *
 * Every value comes back from the server as `state.values` and is applied with
 * `defaultValue`. Controlled inputs would mean the JS-off path renders empty
 * fields after a rejection, which is exactly when preserving the typing matters
 * most.
 *
 * ── THE OPTION LISTS ARRIVE AS PROPS, LIKE `NewAuditForm`'s TIMEZONES ───────
 *
 * They come from the closed vocabularies on `@/db/schema`, and importing those
 * from a client component pulls drizzle's `pg-core` (~97 KiB, measured) into
 * the browser bundle of the page LAND-06 asks to score ≥ 90 on a phone. The
 * server page resolves the labels once and hands them over as plain data — so
 * the select can only offer values the action will accept, which is the same
 * property the console form gets from the same pattern.
 */
export interface AuditFormOption {
  value: string;
  label: string;
}

export function AuditRequestForm({
  trades,
  bands,
}: {
  trades: readonly AuditFormOption[];
  bands: readonly AuditFormOption[];
}) {
  const [state, formAction, pending] = useActionState(
    requestAuditAction,
    BLANK_AUDIT_REQUEST_STATE,
  );

  const describedBy = (field: keyof typeof state.errors, hintId?: string) =>
    [hintId, state.errors[field] ? `${field}-error` : null].filter(Boolean).join(' ') ||
    undefined;

  /**
   * Did the server send this render back rather than redirect? Any failure at
   * all counts, not just a CSV one: a rejected submit clears the file input
   * whatever the reason it was rejected.
   */
  const rejected = state.formError !== null || Object.keys(state.errors).length > 0;

  return (
    <form
      action={formAction}
      method="post"
      encType="multipart/form-data"
      noValidate
      className="audit-form"
    >
      {/* Above the first field, so it is read before anything is re-typed. */}
      {state.formError ? (
        <p className="error" role="alert">
          {state.formError}
        </p>
      ) : null}

      {/* The whole form goes inert while the action runs — one wrapper rather
          than `disabled` on nine controls. */}
      <fieldset disabled={pending}>
        <label htmlFor="business_name">{AUDIT_FORM_COPY.labels.business_name}</label>
        <input
          id="business_name"
          name="business_name"
          type="text"
          required
          maxLength={120}
          autoComplete="organization"
          defaultValue={state.values.business_name}
          aria-invalid={state.errors.business_name ? true : undefined}
          aria-describedby={describedBy('business_name')}
        />
        <FieldError id="business_name-error" message={state.errors.business_name} />

        <label htmlFor="contact_name">{AUDIT_FORM_COPY.labels.contact_name}</label>
        <input
          id="contact_name"
          name="contact_name"
          type="text"
          required
          maxLength={80}
          autoComplete="name"
          defaultValue={state.values.contact_name}
          aria-invalid={state.errors.contact_name ? true : undefined}
          aria-describedby={describedBy('contact_name')}
        />
        <FieldError id="contact_name-error" message={state.errors.contact_name} />

        <label htmlFor="phone">{AUDIT_FORM_COPY.labels.phone}</label>
        <p className="hint" id="phone-hint">
          {AUDIT_FORM_COPY.hints.phone}
        </p>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          inputMode="tel"
          autoComplete="tel"
          defaultValue={state.values.phone}
          aria-invalid={state.errors.phone ? true : undefined}
          aria-describedby={describedBy('phone', 'phone-hint')}
        />
        <FieldError id="phone-error" message={state.errors.phone} />

        <label htmlFor="email">{AUDIT_FORM_COPY.labels.email}</label>
        <p className="hint" id="email-hint">
          {AUDIT_FORM_COPY.hints.email}
        </p>
        <input
          id="email"
          name="email"
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          defaultValue={state.values.email}
          aria-invalid={state.errors.email ? true : undefined}
          aria-describedby={describedBy('email', 'email-hint')}
        />
        <FieldError id="email-error" message={state.errors.email} />

        <label htmlFor="trade">{AUDIT_FORM_COPY.labels.trade}</label>
        <select
          id="trade"
          name="trade"
          required
          defaultValue={state.values.trade}
          aria-invalid={state.errors.trade ? true : undefined}
          aria-describedby={describedBy('trade')}
        >
          {/* Disabled and empty-valued: an unanswered select must fail
              validation rather than silently submit whichever trade happened to
              be first in the list. */}
          <option value="" disabled>
            {AUDIT_FORM_COPY.choosePlaceholder}
          </option>
          {trades.map((trade) => (
            <option key={trade.value} value={trade.value}>
              {trade.label}
            </option>
          ))}
        </select>
        <FieldError id="trade-error" message={state.errors.trade} />

        {/* A radio group is a fieldset with a legend — the label association a
            single `<label>` cannot make across two inputs (D-19). */}
        <fieldset>
          <legend>{AUDIT_FORM_COPY.labels.servicem8}</legend>
          <label className="check">
            <input
              type="radio"
              name="servicem8"
              value="yes"
              required
              defaultChecked={state.values.servicem8 === 'yes'}
              aria-describedby={describedBy('servicem8')}
            />
            {AUDIT_FORM_COPY.yes}
          </label>
          <label className="check">
            <input
              type="radio"
              name="servicem8"
              value="no"
              defaultChecked={state.values.servicem8 === 'no'}
              aria-describedby={describedBy('servicem8')}
            />
            {AUDIT_FORM_COPY.no}
          </label>
          <FieldError id="servicem8-error" message={state.errors.servicem8} />
        </fieldset>

        <label htmlFor="quotes_per_month">{AUDIT_FORM_COPY.labels.quotes_per_month}</label>
        <select
          id="quotes_per_month"
          name="quotes_per_month"
          required
          defaultValue={state.values.quotes_per_month}
          aria-invalid={state.errors.quotes_per_month ? true : undefined}
          aria-describedby={describedBy('quotes_per_month')}
        >
          <option value="" disabled>
            {AUDIT_FORM_COPY.choosePlaceholder}
          </option>
          {bands.map((band) => (
            <option key={band.value} value={band.value}>
              {band.label}
            </option>
          ))}
        </select>
        <FieldError id="quotes_per_month-error" message={state.errors.quotes_per_month} />

        {/* The one optional control (LAND-02). It carries no `required`, and the
            label says "(optional)" rather than every other label carrying an
            asterisk — a form where one field is marked is read faster than a
            form where seven are. */}
        <label htmlFor="csv_file">{AUDIT_FORM_COPY.labels.csv_file}</label>
        <p className="hint" id="csv_file-hint">
          {/* A file input is the ONE control a server cannot re-populate, so
              after any rejection the hint says the export has to be attached
              again — otherwise a second submit silently arrives without it. */}
          {AUDIT_FORM_COPY.hints.csv_file}
          {rejected ? ` ${AUDIT_FORM_COPY.csvReattach}` : null}{' '}
          <Link href="/audit/how-to">{AUDIT_FORM_COPY.hints.csv_file_howto}</Link>
        </p>
        <input
          id="csv_file"
          name="csv_file"
          type="file"
          accept=".csv,text/csv"
          aria-invalid={state.errors.csv_file ? true : undefined}
          aria-describedby={describedBy('csv_file', 'csv_file-hint')}
        />
        <FieldError id="csv_file-error" message={state.errors.csv_file} />

        {/* Directly above the button, where it is read rather than scrolled
            past — the Privacy Act notice the form's collection depends on. */}
        <p className="consent">
          {AUDIT_FORM_COPY.consentLead}
          <a href="/privacy">{AUDIT_FORM_COPY.consentLinkText}</a>
          {AUDIT_FORM_COPY.consentTail}
        </p>

        {/*
          A DECOY, and it is not named for what it is anywhere a script can read
          (UI-SPEC C-8). `website` is the field a form-filling bot completes
          because every other business form has one; a human never sees it.

          Off-screen rather than `display: none` on purpose — a bot that skips
          hidden inputs is a bot that skips this one, which costs nothing, while
          `left: -10000px` still catches the ones that fill everything. The rule
          moved out of an inline style and into `marketing.css` in 09-05, now
          that the stylesheet the form loads with actually exists.

          `aria-hidden` and `tabIndex={-1}` keep it away from a screen reader
          and out of the tab order: a decoy that catches a blind visitor is not
          a spam filter, it is a broken form.
        */}
        {/*
          WHERE THIS SESSION BEGAN — four hidden fields, filled after hydration
          from the record the layout wrote (19 Sep 2026).

          NOT A SECOND DECOY and nothing to do with the one below: these carry no
          judgement about the submitter, they are never validated against, and a
          value the server does not recognise is stored as NULL rather than
          refused. The form's success may not depend on them (LAND-03).

          Below the visible controls and above the decoy, because a hidden input
          has no place in the tab order or in the reading order of the fields a
          person is filling in — it is submitted, not read.
        */}
        <ArrivalSourceFields />

        <div className="hp">
          <label htmlFor="website">{AUDIT_FORM_COPY.decoyLabel}</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
        </div>

        <button
          type="submit"
          className="button button--lg"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? AUDIT_FORM_COPY.submitPending : AUDIT_FORM_COPY.submit}
        </button>
      </fieldset>
    </form>
  );
}
