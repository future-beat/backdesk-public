import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';

import {
  GUIDE_COPY,
  GUIDE_PUBLISHED_ON,
  METADATA_COPY,
  guideDisclaimer,
  guideIsPublished,
} from '../../copy';

/**
 * `/guides/servicem8-quote-follow-up` — the first guide page (M7, LAND-01).
 *
 * A long-form page for a stranger who is searching for help with ServiceM8's
 * own quote follow-ups, not for someone who has already agreed to an audit.
 * That is the whole difference between this page and the audit how-to, and it
 * is why the guide does NOT link there (that page assumes a conversation
 * already happened) — the path is deliberately absent from this file, so a
 * `grep` for it answers zero. It earns its one click by being useful for two
 * thousand words
 * first, so there is exactly ONE button on it, it is the last thing before the
 * disclaimer, and there is no sticky bar, no mid-page call to action and no
 * pop-up (request §2).
 *
 * IT IS HELD DARK UNTIL THE FOUNDER VERIFIES THE MERGE FIELDS. `notFound()` on
 * the first line of the component is the gate: the route is built, deployed and
 * reviewable, and a visitor gets a 404 until `GUIDE_PUBLISHED` and
 * `GUIDE_PUBLISHED_ON` are both set in `../../copy`. The sitemap reads the same
 * predicate, so the page can never be advertised to a crawler that would then
 * be refused (see `src/app/sitemap.ts`).
 *
 * Every sentence is in `../../copy` with the rest of the public strings (D-08),
 * including the three ServiceM8 merge fields, which live in ONE map there so
 * the founder's correction is one edit rather than five. No image, no script,
 * no client component, no new dependency: the marketing layout, the 38em
 * measure and the one copy module are the whole of its design.
 */
export const metadata: Metadata = {
  title: METADATA_COPY.guide.title,
  description: METADATA_COPY.guide.description,
  alternates: { canonical: '/guides/servicem8-quote-follow-up' },
  /*
   * NO `openGraph` OF ITS OWN, and that is how it reuses the OG image the
   * request asked for (§4). The marketing layout already sets `openGraph` with
   * the committed `/brand/og-image.png`, and Next replaces that object wholesale
   * when a page declares one — so a page-level `openGraph` would have to respell
   * the image path, which is the second spelling D-16 exists to prevent. Every
   * other public page inherits it the same way.
   */
};

export default function ServiceM8QuoteFollowUpGuidePage() {
  /*
   * Read into a local first: `guideIsPublished()` is the gate, and the second
   * clause is what tells the type-checker the disclaimer below has a date to
   * render. They cannot disagree — the predicate asserts the same thing — but
   * only the local narrows.
   */
  const publishedOn = GUIDE_PUBLISHED_ON;

  if (!guideIsPublished() || publishedOn === null) notFound();

  const { what, turningOn, schedule, write, settings, limits, pitch, cta } = GUIDE_COPY;

  return (
    <section>
      <div className="wrap">
        <div className="measure guide">
          <h1>{GUIDE_COPY.h1}</h1>
          {GUIDE_COPY.intro.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}

          <h2>{what.h2}</h2>
          <p>{what.lede}</p>
          <ul>
            {what.bullets.map((bullet) => (
              <li key={bullet.slice(0, 32)}>{bullet}</li>
            ))}
          </ul>

          <h2>{turningOn.h2}</h2>
          <ol>
            {turningOn.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>{turningOn.closing}</p>

          <h2>{schedule.h2}</h2>
          <p>{schedule.lede}</p>
          {/*
            Four columns of short cells fit a tablet or a desktop only if the
            TABLE may scroll sideways on its own. The scroller is this wrapper,
            never the page: a guide whose body scrolls horizontally is a guide
            nobody finishes.

            `tabIndex`, `role` and `aria-label` are the console's own convention
            for this box (G-07-6, WCAG 2.1.1): an `overflow-x: auto` container
            with no focusable descendant cannot be scrolled by keyboard, so the
            columns it hides would be pointer-only. The label is the section's
            OWN heading rather than a new sentence — the region a screen reader
            announces should be the one the page already named.

            ON A PHONE IT IS NOT A TABLE AT ALL (Cowork, 15 Sep 2026). Below
            600px `marketing.css` lays these rows out as a list of blocks, so
            nothing scrolls and no header is cut to "JOB OF THE MESS…". It is
            the SAME markup either way: each value carries the column header it
            belongs under in `data-label`, read from `schedule.columns` and
            never retyped, so the label a phone reads and the header a desktop
            reads cannot drift apart.
          */}
          <div className="table-scroll" tabIndex={0} role="region" aria-label={schedule.h2}>
            <table>
              <thead>
                <tr>
                  {schedule.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((row) => (
                  <tr key={row[0]}>
                    {/*
                      The number is the row's header on a desktop and the
                      block's heading on a phone, so it is the one cell with no
                      `data-label`: "#" above a numeral reads as noise. Hence
                      `index + 1` — the labels start at the second column.
                    */}
                    <th scope="row">{row[0]}</th>
                    {row.slice(1).map((cell, index) => (
                      <td key={cell} data-label={schedule.columns[index + 1]}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {schedule.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}

          <h2>{write.h2}</h2>
          <p>{write.lede}</p>
          {/*
            A message is something a reader COPIES, so each one is a block of
            its own whose plain text selects as a unit (`user-select: all` on the
            `<pre>`), with the paragraphs joined by a blank line exactly as they
            would be pasted into the ServiceM8 template editor.
          */}
          {write.templates.map((template) => (
            <Fragment key={template.n}>
              <figure className="template">
                <figcaption>{`${template.n}. ${template.when}, ${template.channel}`}</figcaption>
                <pre>{template.lines.join('\n\n')}</pre>
              </figure>
              {template.note ? <p>{template.note}</p> : null}
            </Fragment>
          ))}
          <p>{write.closing}</p>

          <h2>{settings.h2}</h2>
          <p>{settings.lede}</p>
          <p>
            <strong>{settings.cancelLead}</strong>
          </p>
          <ul>
            {settings.cancels.map((cancel) => (
              <li key={cancel.slice(0, 32)}>{cancel}</li>
            ))}
          </ul>
          <p>{settings.afterCancels}</p>
          <p>
            <strong>{settings.unsuccessfulLead}</strong> {settings.unsuccessful}
          </p>

          <h2>{limits.h2}</h2>
          <p>{limits.lede}</p>
          {limits.items.map((item) => (
            <p key={item.lead}>
              <strong>{item.lead}</strong> {item.body}
            </p>
          ))}
          <p>{limits.closing}</p>

          <h2>{pitch.h2}</h2>
          {pitch.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}

          {/* The ONE button on the page (request §2), and the last thing on it. */}
          <p>
            <Link className="button button--lg" href={cta.href}>
              {cta.label}
            </Link>
          </p>

          {/* Required, not optional (request §6): who we are not affiliated
              with, and how old these steps are. */}
          <p className="disclaimer">{guideDisclaimer(publishedOn)}</p>
        </div>
      </div>
    </section>
  );
}
