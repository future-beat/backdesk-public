# Lighthouse evidence — LAND-06

LAND-06 asks for a mobile Lighthouse score of **90 or better on performance and
accessibility**, for `/` and `/audit`. The JSON files beside this README are the runs that
measured it. They are committed rather than summarised because a score without its report
is a claim.

## The numbers (2026-09-09)

Lighthouse **13.4.1**, mobile preset (the default: 412×823, DPR 1.75, simulated throttling),
headless Chrome **152.0.7977.83**, run from Perth against the **production apex over
HTTPS**. Three runs per page; the **median** is the recorded value.

| Page | URL | Perf runs | **Perf median** | A11y runs | **A11y median** |
|---|---|---|---|---|---|
| Home | `https://backdesk.com.au/` | 99, 97, 97 | **97** | 100, 100, 100 | **100** |
| Audit | `https://backdesk.com.au/audit` | 98, 98, 98 | **98** | 100, 100, 100 | **100** |

Both pages clear the bar on both categories with room to spare, so the research plan's
**A6 performance fallback was not applied** — the `proxy.ts` matcher is untouched and the
app-host `/` → `/clients` rewrite stays where it is. Accessibility is a clean 100 on every
one of the six runs, which is what the UI-SPEC Accessibility Contract was written to buy.

## The confirming run after the copy swap

Plan 09-08 Task 3 applied part of the 11 September Cowork copy request after the six runs
above were taken, so the medians would otherwise describe a page that no longer exists.
One further pass on `/` against the redeployed site:

| File | Perf | A11y |
|---|---|---|
| `2026-09-09-postcopy-confirm.json` | 99 | **100** |

Accessibility is unchanged at 100, which is the thing a copy change could plausibly have
broken (a label, a heading order, a contrast pair). Performance moved inside the same
noise band the three home runs already showed. The recorded medians stand.

## What the files are

`2026-09-09-<page>-<run>.json` — full Lighthouse JSON, one per run, plus the single
`2026-09-09-postcopy-confirm.json` described above.

Each carries its own `requestedUrl`, and every one of the six reads
`https://backdesk.com.au/…`. That assertion matters more than the scores: a Lighthouse
number taken from a walled preview deployment or from `localhost` is not evidence about the
site the public gets, and recording one as if it were is the transparency prohibition this
plan was given (T-9-16). Check it before trusting any future run:

```sh
node -e 'for (const f of require("node:fs").readdirSync("docs/lighthouse").filter(n=>n.endsWith(".json"))) console.log(f, require("./docs/lighthouse/"+f).requestedUrl)'
```

## Rerunning

Production only, never a preview URL. One page, three runs, take the median:

```sh
npx --yes lighthouse@13 https://backdesk.com.au/ \
  --only-categories=performance,accessibility \
  --output=json --output-path=docs/lighthouse/<date>-home-1.json \
  --chrome-flags="--headless=new" --quiet
```

Mobile emulation is the **default** — do not pass `--preset=desktop` and expect these
numbers to be comparable. Read the two scores out with:

```sh
node -e 'const j=require("./docs/lighthouse/<file>.json");console.log(j.requestedUrl, Math.round(j.categories.performance.score*100), Math.round(j.categories.accessibility.score*100))'
```

## Why three runs

Performance is noisy; accessibility is not. The home page moved 99 → 97 → 97 across three
identical runs against an unchanged deployment, purely on network and CPU variance. A
single run either flatters or defames the site by a couple of points, and a single run that
happened to land on 89 would have triggered a fallback the site did not need. The median of
three is cheap insurance against acting on noise.

## What is still costing points

Nothing that needs fixing at 97/98, but recorded so a future regression is legible. The
sub-1.0 audits on both pages are the same short list: `unused-javascript` and
`legacy-javascript-insight` (the Next.js client runtime and its transpilation targets),
`render-blocking-insight` and `network-dependency-tree-insight` (the font and CSS chain),
and `image-delivery-insight`. All are framework-level, none is a Backdesk authoring
mistake, and each would cost more to chase than the two or three points it holds.

If a later run drops below 90, compare that run's failing audits against this list before
changing anything: a new entry is the regression, and the entries above are the floor.
