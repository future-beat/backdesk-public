import type { Metadata } from 'next';

import {
  AUDIT_REQUEST_BANDS,
  AUDIT_REQUEST_TRADES,
  BAND_LABELS,
  TRADE_LABELS,
} from '@/core/intake/audit-request';

import { AUDIT_FORM_COPY, METADATA_COPY } from '../copy';
import { AuditRequestForm } from './form';

/**
 * `/audit` — the request form (LAND-02, D-10).
 *
 * NO `dynamic = 'force-dynamic'`, unlike every console page. This page has no
 * session, reads nothing per-request and must prerender: it is the page a
 * stranger opens on 4G after tapping a link, and LAND-06 asks for ≥ 90
 * Lighthouse performance on a phone. The form's own POST is dynamic; the
 * document it lives in is not.
 *
 * The root layout's title template appends ` · Backdesk`.
 */
export const metadata: Metadata = {
  title: METADATA_COPY.audit.title,
  description: METADATA_COPY.audit.description,
  // The address a search result should point at, whichever host served the
  // page: before the DNS cut-over these pages also answer on the console host,
  // and two hosts serving one page is what a canonical is for (D-18).
  alternates: { canonical: '/audit' },
};

/**
 * The vocabularies are resolved to plain `{ value, label }` data HERE, on the
 * server, so the closed enums (and the drizzle module they live beside) stay
 * out of the browser bundle. The select can therefore only offer values the
 * action will accept — the same guarantee the console's timezone select gets
 * from the same pattern.
 */
const TRADE_OPTIONS = AUDIT_REQUEST_TRADES.map((value) => ({
  value,
  label: TRADE_LABELS[value],
}));

const BAND_OPTIONS = AUDIT_REQUEST_BANDS.map((value) => ({
  value,
  label: BAND_LABELS[value],
}));

export default function AuditRequestPage() {
  return (
    <section>
      {/* The page gutter and the 38em measure (09-05). `main` carries neither
          on the marketing side: the console's `main` padding would gutter every
          landing section twice, so each page brings its own `.wrap`. */}
      <div className="wrap">
        <div className="measure">
          <h1>{AUDIT_FORM_COPY.h1}</h1>
          <p className="lede">{AUDIT_FORM_COPY.lede}</p>

          <AuditRequestForm trades={TRADE_OPTIONS} bands={BAND_OPTIONS} />
        </div>
      </div>
    </section>
  );
}
