import type { Metadata } from 'next';
import Link from 'next/link';

import { LANDING_COPY, METADATA_COPY } from './copy';

/**
 * `/` — the offer, laid out for a phone (LAND-01, D-09).
 *
 * The M2 offer sheet in the order a stranger reads it: the promise, how it
 * works, what it costs, what happens if it does not work, whose name it goes
 * out under, who it is for, how to start. Eight sections, no navigation between
 * them, one action rendered twice.
 *
 * A SERVER COMPONENT WITH NO CLIENT JAVASCRIPT AND NO `dynamic` EXPORT. It
 * prerenders to HTML at build and is served as a file: LAND-06 asks for >= 90
 * Lighthouse performance on a phone, and the surest way to get it is to ship a
 * page with nothing to execute. The internal links are `next/link` because the
 * lint rule for this project requires it of an in-app route, and because the
 * one link that matters here — the audit form — is worth prefetching.
 *
 * Every string comes from `./copy`. Nothing is written inline here, so the
 * 11 September copy revision is a one-file change that this page picks up
 * without being opened (D-08).
 */
export const metadata: Metadata = {
  // Absolute: the root layout's ` · Backdesk` template would otherwise print
  // the name twice on the one page whose title already opens with it.
  title: { absolute: METADATA_COPY.home.title },
  description: METADATA_COPY.home.description,
  alternates: { canonical: '/' },
};

export default function LandingPage() {
  const { hero, steps, pricing, guarantee, customers, fit, start } = LANDING_COPY;

  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="wrap">
          <div className="measure">
            <p className="eyebrow">{hero.eyebrow}</p>
            <h1 id="hero-h">{hero.h1}</h1>
            <p className="lede">{hero.lede}</p>
            {/* The page's ONE action, first render (D-04). */}
            <Link className="button button--lg" href="/audit">
              {hero.cta}
            </Link>
            <p className="eyebrow reassurance">{hero.reassurance}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-it-works-h">
        <div className="wrap">
          <h2 id="how-it-works-h">{steps.h2}</h2>
          {/*
            An ordered list because the order is the content: these four things
            happen in this sequence, and a grid of cards would invite the eye to
            read them as options. The number is a text line, not a circle: no
            icons anywhere on this page (M1 imagery rule).
          */}
          <ol className="steps">
            {steps.items.map((step) => (
              <li key={step.number}>
                <span className="step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <p>
            <Link href="/audit/how-to">{steps.howToLink}</Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="pricing-h">
        <div className="wrap">
          <h2 id="pricing-h">{pricing.h2}</h2>
          <p className="caption">{pricing.caption}</p>

          {/*
            Not a table. A plan whose "Included" cell is prose does not
            survive a 390px screen as a column; a card does, and the phone is
            where this is read (C-5). One plan since 17 Oct 2026 (founder,
            quick 261017-s1c): the list renders one card, and a second plan
            would be a copy edit, not a layout change.
          */}
          <ul className="tiers">
            {pricing.tiers.map((tier) => (
              <li className="tier" key={tier.name}>
                <h3>{tier.name}</h3>
                <p className="price">
                  {/* Green, 700, tabular: standalone dollar figures are the
                      only green text on the page besides the links (D-04,
                      M1 §3). */}
                  <strong className="figure">{tier.price}</strong> <span className="per">{tier.per}</span>
                </p>
                {/* Ink, not green: "No setup fee." states a removal; it is
                    not the number being read. */}
                <p className="setup">{tier.setup}</p>
                <div>
                  <p className="included-label">{pricing.includedLabel}</p>
                  <ul className="included">
                    {tier.included.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>

          <div className="callout">
            <h3>{pricing.trial.h3}</h3>
            <p className="price">
              <strong className="figure">{pricing.trial.figure}</strong>{' '}
              <span className="per">{pricing.trial.per}</span>
            </p>
            <p>{pricing.trial.body}</p>
          </div>

          <p className="terms">{pricing.terms}</p>
        </div>
      </section>

      <section aria-labelledby="guarantee-h">
        <div className="wrap">
          <h2 id="guarantee-h">{guarantee.h2}</h2>
          {/* Ink left border, no green: the most load-bearing paragraph on the
              page is not the page's action (C-6). */}
          <div className="callout callout--guarantee">
            <p>{guarantee.body}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="your-customers-h">
        <div className="wrap">
          <div className="measure">
            <h2 id="your-customers-h">{customers.h2}</h2>
            {customers.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 32)}>{paragraph}</p>
            ))}
            {/*
              LAND-05 lives in this paragraph: storage in Sydney, the offshore
              processing named rather than glossed, and the notice one tap away
              from the claim.
            */}
            <p>
              {customers.residencyLead}
              <Link href="/privacy">{customers.residencyLinkText}</Link>
              {customers.residencyTail}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="good-fit-h">
        <div className="wrap">
          <div className="measure">
            <h2 id="good-fit-h">{fit.h2}</h2>
            <p>{fit.body}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-to-start-h">
        <div className="wrap">
          <div className="measure">
            <h2 id="how-to-start-h">{start.h2}</h2>
            <p>{start.body}</p>
            {/* The SAME action, second render. Still one action (D-04). */}
            <Link className="button button--lg" href="/audit">
              {start.cta}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
