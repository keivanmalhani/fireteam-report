# fireteam report

[![CI](https://github.com/keivanmalhani/fireteam-report/actions/workflows/ci.yml/badge.svg)](https://github.com/keivanmalhani/fireteam-report/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Live: https://keivanmalhani.github.io/fireteam-report/

Compare a Destiny 2 fireteam's raid and dungeon clears and get a ranked list of what to run tonight.

## What it is for

Raid Report tells you what you did. This tells you what to run tonight.

Every other Destiny stats site is built around one player. You look up your own
name, you see your own clears, and that is the end of it. That does not answer
the question a group of friends actually asks on a Tuesday evening, which is
"what should we run, given who showed up". Answering that needs everybody's
numbers side by side, and then it needs an opinion about them.

Put two to six Bungie Names in, and you get:

- a matrix of who has cleared what, activity down the side and player across the top
- a ranked list of what to run, each with one sentence saying why
- per player totals, distinct raids cleared, and the activity they run most
- a link that loads the same fireteam for anyone you paste it to
- a plain text summary sized for a Discord message
- a 1200x630 share card of the top pick, which is also the site's og:image

## The recommendations

The ranking is the point. It is an opinion, not a sort:

| Rule | Fires when | Why it ranks there |
| --- | --- | --- |
| Sherpa run | Exactly one player has no clears, everyone else has at least one | Best thing a full fireteam can do with an evening. The site names the player. |
| Everyone's first | Nobody in the fireteam has cleared it | Nobody is bored and nobody is being carried. |
| Speedrun | Every player has five or more clears | Fast, clean, low friction. |
| Rusty | Everyone has cleared it, but the fireteam total is low | A warning. Expect it to be slow. |
| Lopsided | One player has more clears than everyone else combined | A warning. That player will end up calling the whole thing. |

Sherpa runs rank first, then everyone's first, then speedruns. Rusty and
lopsided sit below those because they are warnings, not suggestions. The site
says this on the page too, so the order is not a black box.

The displayed list will not show the same verdict more than twice in a row; it
pulls the next different verdict up instead. A fireteam runs one thing tonight,
so the fourth best sherpa run tells you almost nothing the first one did not,
while the best speedrun tells you something new. This is display order only,
kept in a separate function from the ranking: it never changes which activities
are recommended or what verdict each one gets, and the order inside a verdict
is preserved.

The engine is a pure function in `src/recommend.ts`. It takes a matrix of
numbers and returns ranked recommendations. It does no fetching, so it is
tested directly against fixture matrices, including the cases where each rule
must not fire.

## Why it does not go stale

The list of raids and dungeons is not hardcoded. On each visit the site reads
Bungie's manifest, pulls the activity definitions, and keeps everything tagged
with activity mode 4 (raid) or 82 (dungeon).

That matters because Destiny ships new raids. A hardcoded list needs a commit
and a deploy every time; a derived list picks up a new raid the moment Bungie
publishes the manifest entry, with no work from anyone.

The derived list is cached in `localStorage` against the manifest version
string, so the definition file is downloaded once and then not again until
Bungie publishes a new version. A snapshot is committed in
`src/fallback-activities.ts` and used only when bungie.net cannot be reached,
so the page still renders when the API is down. A test re-derives that snapshot
from committed raw definitions, so it cannot drift away from the collapsing
rules without CI noticing.

Bungie ships one definition per difficulty, so a single raid arrives as
"Vault of Glass: Standard", "Vault of Glass: Master" and
"Vault of Glass: Challenge Mode". Those collapse into one row with the tiers
tracked underneath. The suffixes stripped are `Standard`, `Normal`, `Master`,
`Legend`, `Expert`, `Contest`, `Prestige`, `Challenge Mode` and `Level NN`.
Pantheon is grouped separately, because it carries the raid mode flag but is a
boss rush rather than a raid. Bungie tags Crota's End as both a raid and a
dungeon; raid wins, so it appears once.

As of manifest version 244213.26.06.29.2000-1-bnet.65583 that is 37 raid names
and 21 dungeon names collapsing into 14 raids, 9 dungeons and 4 Pantheon
encounters.

## Getting an API key

The site opens in demo mode against a committed fixture fireteam, so you can
see the whole thing working before deciding whether to bother. Looking up real
players needs an API key, because Bungie requires one on every per player
endpoint.

The key is free, there is no approval step, and it takes about two minutes:

1. Open https://www.bungie.net/en/Application and sign in.
2. Choose **Create New App**.
3. Application Name: anything.
4. Website: the address of the page you will use it on.
5. OAuth Client Type: **Not Applicable**.
6. Origin Header: `https://keivanmalhani.github.io`, exactly. This is the field
   people miss. Without it the browser call is refused.
7. Accept the terms, create the app, and copy the **API Key**.

Paste it into the API key dialog on the site. It is stored in your browser's
`localStorage` and sent to bungie.net and nowhere else. There is no server
behind this site to send it to. Clearing it from the same dialog removes it.

`localStorage` holds two things and nothing else: your key, and the cached
activity list.

## What it will not do

- **It will not read private accounts.** If someone has their Destiny privacy
  set so stats are hidden, the site says so in their column instead of showing
  a zero, because "no clears" and "would not say" are different answers.
- **It will not tell you what is currently in the game.** The manifest still
  contains sunset content such as Leviathan and Scourge of the Past. They show
  up as rows. There is no reliable "currently available" flag in the activity
  definitions, so filtering them would mean hardcoding a list, which is exactly
  what the manifest approach avoids.
- **It does not know about anything except raids and dungeons.** No strikes, no
  Crucible, no Trials, no seasonal activities.
- **It does not know when you cleared something.** The aggregate stats endpoint
  gives totals, not dates, so it cannot tell a clear from last night from one
  in 2018. "Rusty" is inferred from low totals, not from time since last run.
- **It does not check whether you actually have the DLC** that an activity
  belongs to.
- **It has no accounts and stores nothing.** Close the tab and the only trace
  is your key and the cached activity list, both in your own browser. Share
  links carry the fireteam in the URL hash, which browsers do not send to
  servers.
- **It is not affiliated with Bungie.**

## Running it

```
npm ci
npm test          # vitest
npm run build     # typecheck and bundle to dist/
npm run dev       # local dev server
npm run derive    # refetch the manifest and regenerate the fallback table
npm run ascii     # fail on any non-ascii byte in a text file
```

`npm run derive` fetches the live manifest, rewrites
`src/fallback-activities.ts` and `fixtures/activity-defs.json`, and prints the
counts it derived. Run it when Bungie ships a new raid if you want the
committed snapshot to match.

The share card is rendered to `public/og.png` by `scripts/render-og.mjs`,
which is deliberately outside the build because it needs a native canvas:

```
npm install --no-save @napi-rs/canvas
node scripts/render-og.mjs
```

## Layout

```
src/
  activities.ts          collapsing variants into one row per activity (pure)
  recommend.ts           the recommendation engine (pure)
  permalink.ts           fireteam to and from the URL hash (pure)
  bungiename.ts          Name#1234 parsing (pure)
  aggregate.ts           summing stats across characters (pure)
  discord.ts             the copy for Discord text (pure)
  card.ts                the 1200x630 share card, layout and drawing (pure layout)
  manifest.ts            manifest fetch, version keyed cache, fallback
  bungie.ts              API client and per player lookup
  fallback-activities.ts generated snapshot, do not edit by hand
  demo.ts                demo mode
  ui/                    DOM rendering
  main.ts                entry point
fixtures/
  activity-defs.json     real raid and dungeon definitions, for the tests
  demo.json              the six player demo fireteam
tests/                   vitest suite
public/
  og.png                 the demo fireteam's card, rendered by hand
scripts/                 manifest derivation, demo generation, og image
```

The pure modules hold everything worth testing and none of them import `fetch`.

## Notes on the Bungie API

- `GET /Platform/Destiny2/Manifest/` usually answers without an API key, but not
  always. It intermittently returns HTTP 500 with
  `ApiKeyMissingFromRequest`, so the site retries, attaches the user's key when
  there is one, and falls back to the committed snapshot if it still fails.
- The activity definition file it points at is served with
  `access-control-allow-origin: *` and needs no key at all.
- Per player endpoints do need `X-API-Key`. Bungie reflects the request origin
  in `access-control-allow-origin` and allows `X-API-Key` in
  `access-control-allow-headers`, which is what lets a static site on
  github.io call the API directly with no backend.
- A Destiny account holds up to three characters and aggregate stats are
  reported per character, so clears are summed across all of them.
- Every request has a deadline and the retry loop has an overall budget. A
  refused connection fails fast, but a connection that is accepted and then
  never answered would otherwise hang forever and never reach the fallback,
  which leaves the page on a spinner with no way out. Captive portals and flaky
  mobile connections do exactly that.

## Security

See [SECURITY.md](SECURITY.md). Short version: report privately through the
Security tab, there is no server and no key of its own, and the most recent
tagged release is what is supported.

## Licence

MIT. See [LICENSE](LICENSE).
