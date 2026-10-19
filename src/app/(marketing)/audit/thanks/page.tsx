import type { Metadata } from 'next';
import Link from 'next/link';

import { HOWTO_COPY, METADATA_COPY, THANKS_COPY } from '../../copy';

/**
 * `/audit/thanks` — the confirmation (LAND-02, D-14).
 *
 * `robots: { index: false }`: this page is reached by a 303 after a successful
 * write and says nothing a search result should carry. A direct GET still
 * renders — it needs no state, so a refresh or a shared link is a page rather
 * than an error.
 *
 * NO ACCOUNT AND NO LOGIN LINK anywhere on it (D-14). The prospect's next step
 * is us contacting them; offering a sign-in would be offering something that
 * does not exist.
 *
 * The two contact values now come from `@/core/brand` through `THANKS_COPY`
 * (09-05), so the number on this page is the number in every footer.
 *
 * THE HOW-TO BLOCK IS HERE, NOT JUST LINKED (copy request §3.3). A prospect who
 * has just submitted is the most willing they will ever be, and the next thing
 * the service needs from them is data out of ServiceM8. Making that a click
 * away spends that willingness on a page load. The lists and the sentence are
 * the SAME values `/audit/how-to` renders, from `HOWTO_COPY` — two spellings of
 * a step is one spelling that goes stale after the founder verifies the menus.
 */
export const metadata: Metadata = {
  title: METADATA_COPY.thanks.title,
  description: METADATA_COPY.thanks.description,
  robots: { index: false },
};

export default function AuditThanksPage() {
  return (
    <section>
      <div className="wrap">
        <div className="measure">
          <h1>{THANKS_COPY.h1}</h1>
          <p>{THANKS_COPY.body}</p>

          <section aria-labelledby="how-to-h">
            <h2 id="how-to-h">{HOWTO_COPY.thanksH2}</h2>

            {HOWTO_COPY.options.map((option) => (
              <section key={option.id} aria-labelledby={`${option.id}-h`}>
                <h3 id={`${option.id}-h`}>{option.h2}</h3>
                <ol>
                  {option.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>
            ))}

            <p>{HOWTO_COPY.sentence}</p>
            <p>
              <Link href="/audit/how-to">{HOWTO_COPY.thanksLink}</Link>
            </p>
          </section>

          <p>
            {THANKS_COPY.contactLead}
            <a href={`mailto:${THANKS_COPY.contactEmail}`}>{THANKS_COPY.contactEmail}</a> or{' '}
            <a href={`tel:${THANKS_COPY.contactPhoneE164}`}>{THANKS_COPY.contactPhoneDisplay}</a>.
          </p>
          <p>
            <Link className="button button--secondary" href="/">
              {THANKS_COPY.backLink}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
