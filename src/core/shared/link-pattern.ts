/**
 * Link-shaped text: a scheme, a `www.`, or a dotted host with a TLD-like tail.
 *
 * ONE SPELLING, TWO VALIDATORS (13-REVIEW WR-02):
 *
 *   - the text-back validator (`src/core/leads/template.ts`, `extra_link`),
 *     which runs it on the body with every copy of the privacy pointer
 *     removed, so the pointer is the only link a text-back can carry;
 *   - the draft validator (`src/core/drafting/validate.ts`, Rule 5), which
 *     runs it on a LEAD draft's model text (`forbidLinks`), so D-13's "no
 *     links" is mechanical rather than a prompt instruction.
 *
 * A LEAF WITH NO IMPORTS, on purpose. `src/core/leads` may import nothing from
 * the drafting layer but the septet counter (tests/text-back-structure.test.ts),
 * and `validate.ts` is pure and framework-free; a shared module neither layer
 * owns is the one place both can read without bending either rule.
 *
 * Over-refuses by design: a missing space after a full stop ("job.Thanks")
 * reads as a host and is refused — one regeneration, or one operator edit —
 * where a URL reaching a stranger's phone in a tradie's name is the failure.
 * Not global, so `.test` / `.match` carry no `lastIndex` between calls.
 */
export const LINK_PATTERN = /https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}/i;
