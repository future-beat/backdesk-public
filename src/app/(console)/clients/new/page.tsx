import type { Metadata } from 'next';

import { NewClientForm } from './form';

export const metadata: Metadata = { title: 'New client' };

const DEFAULT_TIMEZONE = 'Australia/Perth';

/**
 * Australian IANA zones, read from the runtime rather than hardcoded so the list
 * tracks the tzdata the server actually has — and so the select can only offer
 * zones `tenantCreateSchema` will accept. Falls back to the default alone if
 * the runtime does not expose supportedValuesOf.
 */
function australianTimezones(): string[] {
  const supported = Intl.supportedValuesOf?.('timeZone') ?? [];
  const zones = supported.filter((zone) => zone.startsWith('Australia/'));
  return zones.length > 0 ? zones : [DEFAULT_TIMEZONE];
}

export default function NewClientPage() {
  return (
    <section>
      <h1>New client</h1>
      <NewClientForm timezones={australianTimezones()} defaultTimezone={DEFAULT_TIMEZONE} />
    </section>
  );
}
