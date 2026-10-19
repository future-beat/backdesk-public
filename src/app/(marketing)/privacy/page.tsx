import type { Metadata } from 'next';

import { METADATA_COPY, PRIVACY_COPY } from '../copy';

/**
 * `/privacy` — a real notice, not a shield (LAND-05, D-16).
 *
 * The form asks a stranger for their customers' names and phone numbers before
 * they have met anyone here. This page is the answer to the question that
 * should provoke, in the APP 1 and APP 5 shape: what is collected, why, where
 * it lives, who else touches it, how long it stays, how to get it back, and who
 * to write to. Every sentence is in `../copy` with the rest of the public
 * strings, and the two sentences a regulator would care about — Sydney storage,
 * offshore processing — are pinned byte for byte by `tests/privacy-page.test.ts`.
 *
 * Prose at the 38em measure, one `h1`, seven labelled sections, no client
 * JavaScript. It prerenders like the rest of the marketing tree.
 */
export const metadata: Metadata = {
  title: METADATA_COPY.privacy.title,
  description: METADATA_COPY.privacy.description,
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <section>
      <div className="wrap">
        <div className="measure">
          <h1>{PRIVACY_COPY.h1}</h1>
          <p className="eyebrow">{PRIVACY_COPY.dateLine}</p>

          {PRIVACY_COPY.sections.map((section) => (
            <section key={section.id} aria-labelledby={`${section.id}-h`}>
              <h2 id={`${section.id}-h`}>{section.h2}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 32)}>{paragraph}</p>
              ))}
              {/*
                The contact section is the only one with more than prose in it,
                and the two links are the whole point of the section: an access
                request nobody can send is not access.
              */}
              {'email' in section ? (
                <p>
                  <a href={`mailto:${section.email}`}>{section.email}</a> ·{' '}
                  <a href={`tel:${section.phoneE164}`}>{section.phoneDisplay}</a>
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
