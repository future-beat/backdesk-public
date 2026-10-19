---
phase: 09-landing-page-audit-intake
reviewed: 2026-09-09T09:52:51Z
depth: standard
files_reviewed: 55
files_reviewed_list:
  - eslint.config.mjs
  - next.config.ts
  - scripts/audit-requests-count.mjs
  - scripts/brand/og-image.html
  - scripts/brand/render-brand-assets.sh
  - scripts/setup-storage.mjs
  - src/app/(console)/audits/[id]/actions.ts
  - src/app/(console)/audits/[id]/audit.css
  - src/app/(console)/audits/[id]/page.tsx
  - src/app/(console)/audits/new/actions.ts
  - src/app/(console)/audits/new/form.tsx
  - src/app/(console)/audits/new/page.tsx
  - src/app/(console)/audits/page.tsx
  - src/app/(console)/audits/requests/[id]/action-state.ts
  - src/app/(console)/audits/requests/[id]/actions.ts
  - src/app/(console)/audits/requests/[id]/csv/route.ts
  - src/app/(console)/audits/requests/[id]/page.tsx
  - src/app/(console)/audits/requests/[id]/status-form.tsx
  - src/app/(console)/audits/requests/page.tsx
  - src/app/(console)/clients/new/actions.ts
  - src/app/(console)/clients/page.tsx
  - src/app/(console)/layout.tsx
  - src/app/(console)/reports/[client]/[reportId]/page.tsx
  - src/app/(console)/reports/[client]/[reportId]/report.css
  - src/app/(marketing)/audit/action-state.ts
  - src/app/(marketing)/audit/actions.ts
  - src/app/(marketing)/audit/field-error.tsx
  - src/app/(marketing)/audit/form.tsx
  - src/app/(marketing)/audit/page.tsx
  - src/app/(marketing)/audit/thanks/page.tsx
  - src/app/(marketing)/copy.ts
  - src/app/(marketing)/fonts.ts
  - src/app/(marketing)/layout.tsx
  - src/app/(marketing)/marketing.css
  - src/app/(marketing)/page.tsx
  - src/app/(marketing)/privacy/page.tsx
  - src/app/api/internal/stalled-digest/route.ts
  - src/app/globals.css
  - src/app/layout.tsx
  - src/app/login/page.tsx
  - src/app/not-found.tsx
  - src/app/robots.ts
  - src/app/sitemap.ts
  - src/core/alerts/operator-email.ts
  - src/core/alerts/operator-sms.ts
  - src/core/audit/csv-mapping.ts
  - src/core/brand.ts
  - src/core/intake/audit-request.ts
  - src/core/intake/csv-sniff.ts
  - src/core/intake/ip-hash.ts
  - src/core/intake/throttle.ts
  - src/core/shared/env.ts
  - src/db/migrations/0035_phase9_audit_requests.sql
  - src/db/repository/audit-requests.ts
  - src/db/repository/audit-uploads.ts
  - src/db/repository/index.ts
  - src/db/schema/audit-requests.ts
  - src/db/schema/index.ts
  - src/lib/supabase/proxy.ts
  - src/proxy.ts
  - supabase/config.toml
  - tests/audit-request-notify.test.ts
  - tests/audit-request-throttle.test.ts
  - tests/brand.test.ts
  - tests/console-error-leak.test.ts
  - tests/lint-ban.test.ts
  - tests/marketing-copy.test.ts
  - tests/proxy-host-routing.test.ts
  - tests/rls-coverage.test.ts
findings:
  critical: 0
  warning: 5
  info: 5
  total: 10
fixed: 5
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-09-09T09:52:51Z
**Depth:** standard
**Files Reviewed:** 55 source files (plus the 8 structural test suites named above; 20 remaining test files in the diff were scanned for pin changes only)
**Status:** issues_found

## Summary

Scope was the `2b43dec..HEAD` diff for Phase 9: the public marketing route group, the session-less audit-request server action and its intake modules, the two tenant-independent tables and their migration, the private Storage bucket and its purge, the operator email/SMS notifiers, the host-aware proxy, the console request list/detail/CSV/status surfaces, the `audits/new` pre-fill, and the brand/token/metadata work.

The security-relevant core holds up under scrutiny. The public action orders decoy → zod → throttle → sniff → insert → upload → notify → record exactly as documented and returns from every branch; the throttle is a single atomic `INSERT … ON CONFLICT … RETURNING`; the IP is salted-hashed and never logged; every catch logs an error *name* only; the Storage client is confined to `src/db/repository/audit-uploads.ts` behind the barrel and the eslint deep-import ban; no `storage.objects` policy or signed URL exists; the CSV route calls `requireOperator()` before awaiting `params` and answers a bodiless 404 to every refusal; the object key is `{uuid}/{allowlist-sanitised name}`; `Content-Disposition` is re-sanitised; the migration's REVOKE-then-GRANT block matches the `prospects` precedent and the rls-coverage suite pins it; the redirect target after submit is a constant; hosts are matched by exact `Set` lookup on the lower-cased `Host` header. Live proofs re-run today: apex `/inbox`, `/audits/requests`, `/__not_found` → 404; `/audit/thanks` → 200; `/login` → **200** (the known gap, WR-01); `/favicon.ico` → 404 (deferred, not flagged).

Five warnings. One is the already-recorded apex `/login` gap with a concrete matcher fix. Three are in the notification path: the email *subject* skips the control-character strip the body gets; the SMS body is sent un-normalised while its one-segment test measures a normalised copy; and the SMS body also takes newlines verbatim. One is a correctness gap in conversion: the stored object is deleted but the row's four CSV columns are never cleared, so the console offers a dead "Download CSV" for up to 30 days. Five info items cover dead input, duplicated contact strings, React keys, status transitions and an IPv6-literal edge in the host parser.

Deliberately not flagged, per the review brief: the 4 MiB cap, no CAPTCHA, console `/` → `/clients`, no analytics, the deferred M1 §5 messaging copy, the partial copy swap, the missing root `/favicon.ico`, the missing TDD RED commits in 09-06, and the `GRANT SELECT … TO anon` pattern (matches `prospects`, pinned by rls-coverage).

## Warnings

### WR-01: Apex `/login` serves the console sign-in form (200) because the matcher exempts it on every host

**Fixed:** `3ab6e19` — Matcher exemption dropped; `PUBLIC_PATHS` keeps the form open on console hosts. Apex and `www` `/login` pinned to 404 in `tests/proxy-host-routing.test.ts`; the `/login` case in `tests/sync-tick-route.test.ts` inverted. Proved live after deployment `a2e7559xq`: apex `/login` **404** (no `location`, branded 404 body), `app` `/login` **200** with the form intact, apex `/` **200**. Recorded in `docs/external-registrations.md` and §9 of `docs/vercel-domains-and-protection.md` (`be4d1ae`). This closes 09-VERIFICATION gap T-9-23.

**File:** `src/proxy.ts:135` (matcher), `src/proxy.ts:75-90` (marketing branch), `src/lib/supabase/proxy.ts:7,75-77` (`PUBLIC_PATHS`)
**Issue:** Cross-references 09-VERIFICATION gap T-9-23. `login$|login/` is excluded from `config.matcher`, so the `MARKETING_HOSTS` branch never runs for `/login` and cannot rewrite it to the 404. Confirmed live today: `curl -sI https://backdesk.com.au/login` → `HTTP/2 200`. The exclusion is also redundant on console hosts: `updateSession` already treats `/login` as public via `PUBLIC_PATHS` (line 75-77) and returns `response` without redirecting, so removing it from the matcher changes nothing on `app.backdesk.com.au` beyond one `getClaims()` call on the login page. Not an auth bypass (the form is public on the app host anyway), but a login on the apex sets Supabase cookies on a host whose console paths all 404, and the recorded truth is falsified.
**Fix:** Drop the login exemption from the matcher and let `PUBLIC_PATHS` keep `/login` open on console hosts; pin the apex case.
```ts
// src/proxy.ts
matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|audit$|audit/|privacy$|brand/|robots.txt$|sitemap.xml$).*)'],
```
```ts
// tests/proxy-host-routing.test.ts — add beside the existing 404 cases
it('answers 404 for /login on the apex host', async () => {
  const request = new NextRequest('http://apex.localhost/login', { headers: { host: 'backdesk.com.au' } });
  const response = await proxy(request);
  expect(response.status).toBe(404);
});
```
Update the three matcher-parsing suites (`tests/sync-tick-route.test.ts`, `cadence-tick-route`, `messaging-reconcile-route`) if they assert `/login` is unmatched, change the `still exempts the API routes and the login form` case to assert `/login` now matches, and add `curl -sI https://backdesk.com.au/login → 404` to the evidence entry.

### WR-02: The operator email *subject* interpolates the business name without the control-character strip the body gets

**Fixed:** `a295607` — `alertSubject` now strips, for all three kinds rather than just `audit_request` — the sync names are operator-typed, so one rule beats a conditional. The header-injection test asserts the subject as well as the body.

**File:** `src/core/alerts/operator-email.ts:170` (`alertSubject`), `:332-335` (call site), `:186-188` (`stripControlCharacters`)
**Issue:** T-9-08's mitigation is `stripControlCharacters`, applied to every interpolated value in `auditRequestAlertBody` — but `alertSubject('audit_request', input.businessName)` receives the raw zod output. zod's `.trim()` removes leading/trailing whitespace only; an embedded `\r\n` survives `.max(120)`. The subject is the one form value that becomes an actual MIME *header* rather than body text. Resend's JSON API most likely folds or rejects the newline, so this is defence-in-depth rather than a demonstrated exploit, but the module's own header says the strip "is the control that makes the relaxation safe" and it is missing on exactly the header-shaped field. The notify test (`tests/audit-request-notify.test.ts:127-146`) asserts the strip on the body and never on the subject.
**Fix:** Strip in `alertSubject` for the audit kind (the sync kinds pass a tenant name the operator typed, so stripping there is harmless too), and add a subject assertion to the header-injection test.
```ts
export function alertSubject(kind: OperatorAlertKind, tenantName: string): string {
  const name = stripControlCharacters(tenantName);
  if (kind === 'audit_request') return `${SERVICE_NAME} · Audit request: ${name}`;
  return kind === 'auth_failed'
    ? `ServiceM8 connection failed — follow-ups paused for ${name}`
    : `ServiceM8 sync degraded for ${name}`;
}
```
```ts
// tests/audit-request-notify.test.ts, inside the header-injection case
const subject = alertSubject('audit_request', 'Acme\r\nBcc: x@evil.test');
expect(subject).not.toMatch(/[\r\n]/);
```

### WR-03: The SMS is sent un-normalised, but its one-segment test measures a normalised copy — smart punctuation or `ë` in a name makes it a 3-segment UCS-2 message

**Fixed:** `4b73af1` — `normalizeForGsm7` moved inside `cut`, BEFORE the code-point cap (normalising can grow a string: `…` → `...`). The tests now count the raw return value. Added: smart punctuation → gsm7/one segment, and the honest residual pinned — `ë` has no GSM-7 lookalike, so that body is still UCS-2, which is the right answer and is now a known number rather than a surprise.

**File:** `src/core/alerts/operator-sms.ts:89-102` (`auditRequestSmsBody`), `:164-176` (`sendSms` call), `tests/audit-request-notify.test.ts:174,192`
**Issue:** `sendSms` sends the body verbatim (`clicksend-client.ts:200` states "no charset normalization"). `auditRequestSmsBody` caps code points but never calls `normalizeForGsm7` (which exists at `src/core/drafting/gsm7.ts:202` and is what the escalation path uses). The test then does `countSeptets(normalizeForGsm7(body))` — it proves the invariant on a string production never sends. An iOS keyboard inserts `’` by default (`O’Brien`, `Zoë’s Electrical`), `ë` is outside the GSM-7 basic table, and one such character flips the whole 151-character body to UCS-2 (70 per segment) → 3 segments. The Pitfall 6 budget arithmetic in the module header is therefore only true for ASCII names. Cost is trivial; the defect is that the pinned "one segment" claim is unmeasured for the common case, and the pin is wrong in the direction that hides it.
**Fix:** Normalise inside the body builder and make the test count the raw return value.
```ts
// src/core/alerts/operator-sms.ts
import { normalizeForGsm7 } from '@/core/drafting/gsm7';

function cut(value: string, max: number): string {
  const points = Array.from(normalizeForGsm7(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim());
  return points.length <= max ? points.join('') : points.slice(0, max).join('');
}
```
```ts
// tests/audit-request-notify.test.ts — measure what is sent
const counted = countSeptets(body);            // not countSeptets(normalizeForGsm7(body))
expect(counted).toEqual({ encoding: 'gsm7', septets: 151 });
// and add a case: businessName: 'Zoë’s Electrical', contactName: 'O’Brien' → encoding 'gsm7', 1 segment
```
(Characters `normalizeForGsm7` cannot map will still flip the encoding; that is the honest residual and worth one comment line rather than a claim.)

### WR-04: The SMS body takes user-controlled newlines and control characters verbatim

**Fixed:** `91412a7` — Fixed by hoisting, not by copying the regex: `stripControlCharacters` moved out of `operator-email.ts` (where being private is why the subject and the SMS both missed it) into `src/core/intake/audit-request.ts`, the boundary module. Both notifiers import it. Never applied on the way IN — the row still keeps exactly what the prospect typed.

**File:** `src/core/alerts/operator-sms.ts:76-79` (`cut`), `:97-101`
**Issue:** The email body strips C0/C1 controls (T-9-08); the SMS does not. `business_name` and `contact_name` pass zod with embedded `\n`, `\r`, `\t`, `\u0085` intact. The recipient is only the operator's own handset (T-9-07 holds — no recipient parameter), so this is not a routing risk, but a `\n` in the business name pushes `${contact} ${phone}` and the console link onto separate lines, a `\r` can hide the tail on some handsets, and the septet arithmetic assumes no such characters. The same one-line strip already exists in `operator-email.ts` and is private to that module.
**Fix:** Covered by the `cut` change in WR-03 (replace controls with a space before counting). Better: hoist `stripControlCharacters` out of `operator-email.ts` into `src/core/intake/audit-request.ts` (it is already the boundary module for these strings) and call it from both notifiers, so there is one spelling of the rule.

### WR-05: Converting a request deletes the Storage object but never clears the row's four CSV columns — the console offers a dead "Download CSV" for up to 30 days

**Fixed:** `abfc14f` — The clear is guarded on `deleteAuditUpload`'s own `true`, in the purge's order (object first, row second) — clearing a row whose object survived would strand the file. Pinned: the CSV conversion clears once with the request id; a failed delete clears nothing; the API-key and operator-chose-their-own-file branches clear nothing; and the detail page decides the download on `csv_object_path` alone, which is what makes clearing the column sufficient.

**File:** `src/app/(console)/audits/new/actions.ts:52-66` (`convertRequest`), `src/db/repository/audit-requests.ts:330-337` (`clearAuditRequestCsv`, unused outside the purge)
**Issue:** `convertRequest` calls `markAuditRequestConverted` then `deleteAuditUpload(objectPath)` and returns. Nothing calls `clearAuditRequestCsv` — `grep -rn clearAuditRequestCsv src/app src/core` returns nothing. After conversion the row still carries `csv_object_path`, `csv_filename`, `csv_bytes` and `csv_purge_after`, so:
- `audits/requests/[id]/page.tsx:211-218` renders the `Download CSV` button and filename for an object that no longer exists; clicking it hits `csv/route.ts:76-82` and yields a blank 404 tab.
- `audits/requests/page.tsx:198` shows `· CSV attached` in the list.
- The row sits in `listExpiredAuditUploads` until `csv_purge_after`, when `remove([path])` on a missing object returns no error and the row is finally cleared — so it self-heals, but only after 30 days.
The repository's own docstring says `clearAuditRequestCsv` "forget[s] a purged (or converted) upload", i.e. the call was intended. Also note `markAuditRequestConverted` returning `false` (already converted) still proceeds to delete the object; harmless today because the second caller's `objectPath` was read from the same row.
**Fix:** Clear the columns immediately after a successful delete, in the same order the purge uses (object first, row second).
```ts
// src/app/(console)/audits/new/actions.ts
import { clearAuditRequestCsv, /* … */ } from '@/db/repository';

async function convertRequest(requestId: string, prospectId: string, objectPath: string | null): Promise<void> {
  const marked = await markAuditRequestConverted(requestId, prospectId);
  if (!marked) console.error('[audit-requests] request already converted');
  if (objectPath && (await deleteAuditUpload(objectPath))) {
    await clearAuditRequestCsv(requestId);
  }
  revalidatePath(`/audits/requests/${requestId}`);
  revalidatePath('/audits/requests');
}
```
Add to `tests/audit-request-console.test.ts`: after a CSV-sourced conversion, `clearAuditRequestCsv` was called once with the request id, and the detail page renders "No file attached". (`clearAuditRequestCsv` is already in the barrel and the lint-ban allowlist, so no gate changes.)

## Info

### IN-01: `hashClientIp` keys IPv6 on the first four *textual* fields, so compressed addresses in the same /64 can land in different buckets

**File:** `src/core/intake/ip-hash.ts:76`; `tests/audit-request-throttle.test.ts:68-76`
**Issue:** `ip.split(':').slice(0, 4)` operates on the compressed text form. For `2001:db8::1` and `2001:db8::2` the fields are `['2001','db8','','1']` and `['2001','db8','','2']` — same /64, different keys — while `2001:db8:0:0:0:0:0:1` uncompressed keys as `2001:db8:0:0`. The test only covers the case with four hextets before `::`. On Vercel the header is platform-written and the format is consistent, so a submitter cannot pick the representation; the effect is that the /64 bucketing is weaker than documented for short prefixes, not bypassable. Info rather than warning because the practical throttle still keys on a stable per-visitor value.
**Fix:** Expand before slicing.
```ts
function first64(ip: string): string {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const zeros = Array(Math.max(0, 8 - h.length - t.length)).fill('0');
  return [...h, ...zeros, ...t].slice(0, 4).map((x) => x || '0').join(':');
}
const key = ip.includes(':') ? first64(ip) : ip;
```
Pin: `hashClientIp('2001:db8::1')` equals `hashClientIp('2001:db8:0:0:0:0:0:2')`.

### IN-02: `use_request_file` hidden input is written but never read

**File:** `src/app/(console)/audits/new/form.tsx:172`; `src/app/(console)/audits/new/actions.ts` (no reader)
**Issue:** The form posts `use_request_file=1` when the stored export is being used, but `createAuditAction` decides by `!file && requestId` alone. Dead field; a reader could mistake it for a control.
**Fix:** Remove the hidden input, or make the action honour it (`readString(formData, 'use_request_file') === '1'`) if the intent is an explicit opt-in.

### IN-03: `hello@backdesk.com.au` is spelled by hand in two copy strings while the module imports `CONTACT_EMAIL`

**File:** `src/app/(marketing)/copy.ts:136,138` (vs the brand import at `:27-35`)
**Issue:** D-17 makes `src/core/brand.ts` the single source for contact identity, and `copy.ts` already imports `CONTACT_EMAIL` for the thanks page. `rateLimited` and `serverError` restate the address literally, so a future address change misses the two sentences a prospect reads at the worst moment.
**Fix:** `` `… or email ${CONTACT_EMAIL} with your business name …` `` and `` `… or email ${CONTACT_EMAIL}.` ``; `tests/marketing-copy.test.ts` can assert the literal appears zero times in the source.

### IN-04: React keys derived from `paragraph.slice(0, 32)` collide when two paragraphs share a 32-character prefix

**File:** `src/app/(marketing)/page.tsx:135`, `src/app/(marketing)/privacy/page.tsx:36`
**Issue:** Copy is prose that starts with recurring phrases ("We keep …", "Your customers …"); two paragraphs sharing their first 32 characters produce duplicate keys, a React warning in dev and reconciliation by position. The lists are static, so nothing breaks today, but the 11 Sep copy swap replaces exactly these arrays.
**Fix:** Use the index (`key={index}`) for a static array, or the full string.

### IN-05: Status is a free select with no transition rule, so a converted request can be set back to `new` and re-enter the "N new" count

**File:** `src/app/(console)/audits/requests/[id]/actions.ts:65-71`, `src/db/repository/audit-requests.ts:223-233`
**Issue:** D-15 defines the four values but no transitions; the UI hides "Start audit" after conversion, yet the status control still offers `new`/`contacted` for a row with `converted_prospect_id` set. Choosing `new` makes `/audits` show "(1 new)" for a request that already has an audit. Recorded as info because the design explicitly says every change is reversible; worth one guard.
**Fix:** In `updateAuditRequestStatusAction`, refuse `new` when the row is converted (read via `getAuditRequest`), or in `updateAuditRequestStatus` add `and(eq(id), status === 'new' ? isNull(convertedProspectId) : undefined)` and report "That request has already been turned into an audit."

## Fix status

All five warnings fixed on 2026-09-09, one atomic commit each, in review order.

| Finding | Commit | Files |
|---|---|---|
| WR-01 | `3ab6e19` | `src/proxy.ts`, `tests/proxy-host-routing.test.ts`, `tests/sync-tick-route.test.ts` |
| WR-02 | `a295607` | `src/core/alerts/operator-email.ts`, `tests/audit-request-notify.test.ts` |
| WR-03 | `4b73af1` | `src/core/alerts/operator-sms.ts`, `tests/audit-request-notify.test.ts` |
| WR-04 | `91412a7` | `src/core/intake/audit-request.ts`, `src/core/alerts/operator-email.ts`, `src/core/alerts/operator-sms.ts`, `tests/audit-request-notify.test.ts` |
| WR-05 | `abfc14f` | `src/app/(console)/audits/new/actions.ts`, `src/app/(console)/audits/requests/[id]/page.tsx`, `tests/audit-request-console.test.ts` |
| WR-01 evidence | `be4d1ae` | `docs/external-registrations.md`, `docs/vercel-domains-and-protection.md` §9 |

Gates after the five fixes: 15 touched suites green (695 tests), `npm run typecheck`
clean, `npm run lint` clean (`--max-warnings=0`), `npx next build` clean with
`ƒ Proxy (Middleware)` emitted. Live proofs on production deployment `a2e7559xq`:
apex `/login` **404**, `app` `/login` **200**, apex `/` **200**.

**Status stays `issues_found`:** the five Info findings (IN-01..IN-05) were out of the
fix scope and remain open.

Deliberately not changed while fixing WR-05: `markAuditRequestConverted` returning
`false` still proceeds to delete the object. The review notes this as harmless — the
second caller's `objectPath` was read from the same row — and it is now doubly so,
because the first conversion clears the columns, so a losing second conversion reads a
null path and deletes nothing.

---

_Reviewed: 2026-09-09T09:52:51Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
