import type { MetadataRoute } from 'next';

import { APEX_DOMAIN } from '@/core/brand';

import { guideIsPublished } from './(marketing)/copy';

/**
 * `/sitemap.xml` — the pages a stranger is meant to find (D-18).
 *
 * Absolute apex URLs, whatever host rendered the file: the public site's
 * address is `backdesk.com.au`, and a sitemap that advertised the console host
 * would be asking search engines to index the operator's login.
 *
 * `/audit/thanks` is deliberately absent. It is reached by a redirect after a
 * submit, it is `noindex` in its own metadata, and a confirmation page in a
 * search result is a page someone lands on having confirmed nothing.
 *
 * The how-to page IS listed, and its confirmation-page twin is not, for the
 * same reason: the how-to is a page an owner searches for again a week later
 * and forwards to whoever logs into ServiceM8, and it says nothing that needs a
 * submitted form behind it.
 *
 * THE GUIDE IS LISTED ONLY WHILE IT IS PUBLISHED, and the flag it reads is the
 * SAME `guideIsPublished()` the route itself calls before `notFound()`. Two
 * spellings of "published" is a sitemap entry a crawler fetches and is then
 * refused, which is worse than not being listed at all: it is an instruction to
 * index a page that does not exist.
 *
 * `lastModified` is evaluated once, when this static route is generated at
 * build — not per request. A deploy is the only thing that can change these
 * pages, so the build time is the honest answer.
 */
const GENERATED_AT = new Date();

/** The four that have always been here, in the order a stranger meets them. */
const PUBLIC_PATHS = ['/', '/audit', '/audit/how-to', '/privacy'];

const GUIDE_PATH = '/guides/servicem8-quote-follow-up';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = guideIsPublished() ? [...PUBLIC_PATHS, GUIDE_PATH] : PUBLIC_PATHS;

  return paths.map((path) => ({
    url: `https://${APEX_DOMAIN}${path}`,
    lastModified: GENERATED_AT,
  }));
}
