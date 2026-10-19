import type { Metadata } from 'next';
import Link from 'next/link';

import { HOWTO_COPY, METADATA_COPY } from '../../copy';

/**
 * `/audit/how-to` — the two ways to hand over ServiceM8 data (LAND-05).
 *
 * The page the outreach scripts promise: "I'll send you the steps". It is a
 * public, indexable page rather than an attachment or a text message because a
 * prospect reads it on a job site, forwards it to whoever actually logs into
 * ServiceM8, and comes back to it a week later.
 *
 * Two `<ol>` lists of five steps and one paragraph. No nav item, no script, no
 * new dependency: this is the marketing layout, the 38em measure and the one
 * copy module, which is the whole of its design (D-08, D-19).
 *
 * The steps themselves, and the two claims this page deliberately does NOT
 * make, are argued where the sentences live — `../../copy`, `HOWTO_COPY`.
 */
export const metadata: Metadata = {
  title: METADATA_COPY.howTo.title,
  description: METADATA_COPY.howTo.description,
  alternates: { canonical: '/audit/how-to' },
};

export default function AuditHowToPage() {
  return (
    <section>
      <div className="wrap">
        <div className="measure">
          <h1>{HOWTO_COPY.h1}</h1>
          <p>{HOWTO_COPY.lede}</p>

          {HOWTO_COPY.options.map((option) => (
            <section key={option.id} aria-labelledby={`${option.id}-h`}>
              <h2 id={`${option.id}-h`}>{option.h2}</h2>
              <ol>
                {option.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="small">{option.note}</p>
            </section>
          ))}

          {/* The sentence the copy request fixed word for word: what we do with
              what you send, and what happens to it if nothing comes of it. */}
          <p>{HOWTO_COPY.sentence}</p>

          <p>
            <Link className="button button--secondary" href="/audit">
              {HOWTO_COPY.backLink}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
