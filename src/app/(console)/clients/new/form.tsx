'use client';

import { useActionState } from 'react';

import { createTenant, type CreateTenantState } from './actions';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

/**
 * Note what is NOT here: no contact-hours window, no pre-ticked weekdays.
 * The operator states the window explicitly or the form does not submit —
 * a silently inherited 24/7 window is a DNCR contact-hours breach waiting
 * three phases to happen.
 */
const BLANK: CreateTenantState = {
  errors: {},
  formError: null,
  values: {
    name: '',
    trade_type: '',
    timezone: '',
    contact_hours_start: '',
    contact_hours_end: '',
    contact_days: [],
    escalation_phone: '',
  },
};

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id} role="alert">
      {message}
    </p>
  );
}

/**
 * The only client component in the console.
 *
 * `useActionState` is what lets a rejected submission come back with field
 * errors AND the operator's input, instead of a redirect that throws the form
 * away — the difference matters most on a phone, where retyping a business
 * profile between meetings is how a client never gets onboarded.
 */
export function NewClientForm({
  timezones,
  defaultTimezone,
}: {
  timezones: string[];
  defaultTimezone: string;
}) {
  const [state, formAction, pending] = useActionState(createTenant, BLANK);
  const { errors, values } = state;

  return (
    <form action={formAction}>
      {state.formError ? (
        <p className="error" role="alert">
          {state.formError}
        </p>
      ) : null}

      <label htmlFor="name">Business name</label>
      <input
        id="name"
        name="name"
        type="text"
        required
        autoFocus
        maxLength={120}
        defaultValue={values.name}
        aria-invalid={errors.name ? true : undefined}
        aria-describedby={errors.name ? 'name-error' : undefined}
      />
      <FieldError id="name-error" message={errors.name} />

      <label htmlFor="trade_type">Trade type</label>
      <input
        id="trade_type"
        name="trade_type"
        type="text"
        required
        placeholder="Plumbing, electrical, roofing…"
        defaultValue={values.trade_type}
        aria-invalid={errors.trade_type ? true : undefined}
        aria-describedby={errors.trade_type ? 'trade_type-error' : undefined}
      />
      <FieldError id="trade_type-error" message={errors.trade_type} />

      <label htmlFor="timezone">Timezone</label>
      <select
        id="timezone"
        name="timezone"
        required
        defaultValue={values.timezone || defaultTimezone}
        aria-invalid={errors.timezone ? true : undefined}
        aria-describedby={errors.timezone ? 'timezone-error' : undefined}
      >
        {timezones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <FieldError id="timezone-error" message={errors.timezone} />

      <fieldset>
        <legend>Contact hours</legend>
        <p className="muted hint">
          When this client&rsquo;s customers may be contacted. There is no default — follow-ups
          never go out outside this window.
        </p>

        <label htmlFor="contact_hours_start">From</label>
        <input
          id="contact_hours_start"
          name="contact_hours_start"
          type="time"
          required
          defaultValue={values.contact_hours_start}
          aria-invalid={errors.contact_hours_start ? true : undefined}
          aria-describedby={errors.contact_hours_start ? 'contact_hours_start-error' : undefined}
        />
        <FieldError id="contact_hours_start-error" message={errors.contact_hours_start} />

        <label htmlFor="contact_hours_end">To</label>
        <input
          id="contact_hours_end"
          name="contact_hours_end"
          type="time"
          required
          defaultValue={values.contact_hours_end}
          aria-invalid={errors.contact_hours_end ? true : undefined}
          aria-describedby={errors.contact_hours_end ? 'contact_hours_end-error' : undefined}
        />
        <FieldError id="contact_hours_end-error" message={errors.contact_hours_end} />
      </fieldset>

      <fieldset aria-describedby={errors.contact_days ? 'contact_days-error' : undefined}>
        <legend>Contact days</legend>
        {DAYS.map((day) => (
          <label key={day.value} className="check">
            <input
              type="checkbox"
              name="contact_days"
              value={day.value}
              defaultChecked={values.contact_days.includes(String(day.value))}
            />
            {day.label}
          </label>
        ))}
        <FieldError id="contact_days-error" message={errors.contact_days} />
      </fieldset>

      <label htmlFor="escalation_phone">Escalation phone (optional)</label>
      <input
        id="escalation_phone"
        name="escalation_phone"
        type="tel"
        inputMode="tel"
        placeholder="0412 345 678"
        defaultValue={values.escalation_phone}
        aria-invalid={errors.escalation_phone ? true : undefined}
        aria-describedby={errors.escalation_phone ? 'escalation_phone-error' : undefined}
      />
      <FieldError id="escalation_phone-error" message={errors.escalation_phone} />

      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create client'}
      </button>
    </form>
  );
}
