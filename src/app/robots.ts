import type { MetadataRoute } from 'next';

import { APEX_DOMAIN } from '@/core/brand';

/**
 * `/robots.txt` — one file, both hosts (D-18).
 *
 * A host-aware version would have to read `headers()`, which turns a file that
 * never changes into a function invocation on every crawl. It is also not
 * needed: the same rules are correct on the apex and on the console host,
 * because the console paths are disallowed by name either way and the three
 * public paths exist on both.
 *
 * This is a REQUEST, not a control. It keeps the console out of a search index;
 * it does not keep anyone out of the console. That is `src/proxy.ts` and the
 * `requireOperator()` call in every action (T-9-29).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/audit', '/privacy'],
      disallow: [
        '/login',
        '/inbox',
        '/queue',
        '/leads',
        '/audits',
        '/reports',
        '/clients',
        '/settings',
        '/api/',
      ],
    },
    sitemap: `https://${APEX_DOMAIN}/sitemap.xml`,
  };
}
