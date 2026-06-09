# Compound Scaling Dashboard — codebase notes

Read this before making changes. It captures what's non-obvious about this
repo and what's changed recently.

## What this app is

A single-page operations dashboard for **Compound Scaling**, Luca's
cold-email and (eventually) LinkedIn outreach agency. It started as a pure
cold-email tracker on Instantly and is being evolved into a multi-channel
ops center. Deployed via GitHub Pages on `main`.

## Stack and build

- **Vanilla React 18** loaded from unpkg UMD bundles. `@babel/standalone`
  transpiles JSX in the browser. **No build step, no bundler, no npm.**
- All source files are plain JS/JSX/CSS loaded directly by `index.html`.
- Cache-busting via query-string: every script/style tag in `index.html`
  uses `?v=N`. Bump `N` (e.g. `?v=25` → `?v=26`) on every PR or hard
  refreshes won't pick up changes. The bump-all-at-once `replace_all`
  edit is the cleanest way to do this.
- Deploy = `git push origin main`. GitHub Pages auto-serves it. There's
  no CI.
- Per user preference (see user memory `feedback_auto_commit_push.md`):
  after code changes, **always commit and push to origin/main without
  asking**. Stage only the files actually touched.

## File layout

- `index.html` — script tags + browser tab title. Tab title is
  "Compound Scaling".
- `app.jsx` (~2300 lines) — the entire `App()` component lives here.
  All state, routing, sidebar, topbar, view bodies, and modals. There
  are no sub-components beyond what's exported from `components.jsx`.
- `components.jsx` — shared display primitives (`Sparkline`, `StatCard`,
  `StatusDot`, `RunwayBar`, `DayChart`, `ClientGroup`, `CampaignRow`,
  `NotifDrawer`). Exposed via `window.<Name>`.
- `data.js` — `window.DASHBOARD_DATA` with `load()` /
  `forceRebuild()` / `loadAnalytics()`. Talks to the Google Apps Script
  endpoint via JSONP (CORS-free from GitHub Pages).
- `derive.js` — `window.CSD.format`, `window.CSD.derive`,
  `window.CSD.aggregate`, `window.CSD.groupByClient`,
  `window.CSD.sumSparklines`. Pure functions, no side effects.
- `dashboard.css` (~3000 lines) + `tokens.css` — all styling. Tokens
  define the cream + navy + gold palette, hairline rules, and the
  spacing scale.
- `instantly-connector.gs` — the Google Apps Script backend.
  Lives in Google's editor, copy is in the repo for reference. Pulls
  from Instantly, normalizes, caches hourly.
- `logo.png` — brand mark, used in sidebar.

## Routing and navigation

**No router.** A single `activeNav` `useState` value (`'campaigns'`,
`'analytics'`, `'clients'`, etc.) drives which view body renders. The
mapping is an if/else chain near the bottom of `App()` (`let viewBody;`).

Sidebar is built around line 530–600 of `app.jsx`. Section dividers
(WORKSPACE, EMAIL, LINKEDIN, ACCOUNT) are plain `<div
class="csd-sidebar-section">` elements between `<nav class="csd-nav">`
blocks. Adding a new page = add a `navItem(...)` call plus a router
branch.

Sidebar has a **collapse toggle** (chevron at bottom). State persists in
`localStorage` under `csd:sidebar-collapsed:v1`. Collapsed = 64px wide,
expanded = 232px, CSS transition on width. Labels, counts, brand text and
section labels hide when collapsed; section dividers compress into thin
rules. Every nav `<a>` has a `title` attribute so it doubles as a tooltip
when collapsed.

## Sidebar structure

```
WORKSPACE
- Overview          (placeholder, Phase 0)
- Goals & Targets   (built in Phase 1, paused — see status below)
- Clients           (live)
- Reports           (placeholder)

EMAIL
- Campaigns         (live, primary feature)
- Inbox Analytics   (live, secondary)
- Lead Lists        (live)

LINKEDIN
- Accounts          (placeholder, Phase 2)
- Performance       (placeholder, Phase 2)

ACCOUNT
- Settings          (placeholder)
```

## Topbar

Renders a context-aware meta pill (top right) based on which page is
active:
- **Email pages + Clients**: `Live · Instantly · <timestamp> · ↻ Rebuild`
  with green pulse.
- **LinkedIn pages**: `Live · HeyReach · Coming soon` (placeholder).
- **Goals & Targets**: `Goals tracking · <N> active`.
- **Overview**: `Multi-channel · Coming soon` (placeholder).
- **Reports / Settings**: existing Instantly live pill (neutral
  fallback).

The "crumb" next to the page title (`· 11 total · 7 active`) only
renders on Campaigns / Analytics / Lead Lists / Clients.

## Phase history

- **Phase 0** (commit `fec2bc6`): sidebar restructure to 4-section
  multi-channel layout, added Overview / Goals & Targets / LinkedIn
  Accounts / LinkedIn Performance placeholders. Renamed app to
  "Compound Scaling Ops Center" (later reverted).
- **Phase 0.5** (commit `9961db9`): reverted brand to "Compound
  Scaling". Added sidebar collapse toggle with localStorage
  persistence.
- **Phase 1** (commit `bfe27d0`): first build of the Goals & Targets
  page with manual entry of everything (assumptions, goals,
  today/week/month actuals, 28-day sparkline). Luca rejected the
  manual pace-tracking approach.
- **Phase 1 redesign** (commit `ab20150`, current): rebuilt Goals page
  around bottleneck detection + recommendations, removed manual pace
  check entirely, auto-pull email metrics from the Instantly campaign
  data already in this app, added monthly churn input + churn-aware
  MRR math, moved Booking rate + Positive reply rate out of "Sales
  funnel" into per-channel cards. Luca is **still not satisfied**
  (see "Status" below).

## localStorage keys in use

- `csd:resolved:v1` — dismissed notifications (24h TTL)
- `csd:open-groups:v1` — expanded client groups on Campaigns
- `csd:status-filter:v1` — Active-only toggle on Campaigns
- `csd:list-names:v1` — manual client name overrides
- `csd:client-names:v1` — same
- `csd:custom-clients:v1` — user-added clients
- `csd:custom-lists:v1` — user-added lead lists
- `csd:deleted-campaigns:v1` — campaigns hidden from view
- `csd:deleted-clients:v1` — clients hidden from view
- `csd:ll-open:v1` — expanded lead-list groups
- `csd:ll-categories:v1` — manual lead-list categories
- `csd:manual-lists:v1` — manual lead-list entries
- `csd:campaign-client:v1` — campaign → client overrides
- `csd:campaign-tags:v1` — campaign → inbox-tag overrides
- `csd:campaign-daily-target:v1` — manual daily-send target per campaign
- `csd:api-key:v1` — Instantly API key (Inbox Analytics fallback)
- `csd:sidebar-collapsed:v1` — sidebar collapse state (Phase 0.5)
- `csd:goals:v1` — Goals list (Phase 1)
- `csd:assumptions:v1` — Goals page assumptions (Phase 1)
- ~~`csd:actuals:v1`~~ — removed in Phase 1 redesign; cleaned up on mount
- ~~`csd:pace-history:v1`~~ — removed in Phase 1 redesign; cleaned up on mount

## Status: Goals & Targets is on hold

The Goals page works but Luca is **not satisfied** with it. Reason:
the math feeds off operational assumptions (close rate, show-up rate,
positive reply rate, etc.) and the data quality upstream isn't good
enough yet — so the bottleneck detection points at approximate values
and the recommendations feel generic. Live email metrics come from
Instantly, but the rest (MRR, clients, churn, CRM funnel rates) are
manual placeholders until a Google Sheets sync lands in Phase 1b.

**The current focus is the cold email dashboard** (Campaigns, Inbox
Analytics, Lead Lists) — making the email data more accurate /
useful so that when Goals gets revisited, it has trustworthy inputs.

**Do not:**
- Reopen Goals page work unless Luca asks.
- Treat the current Goals architecture (bottleneck-first, etc.) as
  locked. He'll likely want to redo it.

**Do:**
- Touch the email pages (Campaigns, Inbox Analytics, Lead Lists),
  the GAS connector, the Instantly data flow, anything that improves
  data quality.

## Things that have surprised past sessions

- The "Compound Scaling" string is overloaded: it's the app brand
  AND the name of one of Luca's internal clients (in `data.js` and
  the GAS connector). When renaming the app, leave the client name
  alone. Lines that gate behavior on `client === 'Compound Scaling'`
  (e.g. the "pinned client" logic) are about the *client*, not the
  brand.
- The Instantly data flow is real and live. `data.js` has a mock
  fallback but in practice every page is pulling live numbers via
  the GAS JSONP endpoint. If you're testing locally and see
  `Live · Instantly · <some time> ago`, it's actually live.
- `setActiveNav` is the only navigation primitive. There's no `useEffect`
  that reacts to URL changes because there are no URLs.
- The Inbox Analytics view has its own data loader (`loadInboxAnalytics`)
  that runs lazily on first visit. It hits a separate GAS endpoint
  (`?action=inbox_analytics`).

## When making changes

1. Read the relevant chunk of `app.jsx` first — it's a single giant
   component, so context matters.
2. Don't refactor `app.jsx` into smaller components unless explicitly
   asked. The monolithic structure is intentional for now.
3. New CSS classes should use the `csd-` prefix and reuse design tokens
   from `tokens.css`.
4. Bump the `?v=N` cache-buster in `index.html` if you change any of
   `app.jsx` / `dashboard.css` / `components.jsx` / `data.js` / `derive.js`.
5. Verify in a local preview (a static server pointed at the repo root)
   before committing. The harness has a `preview_start` helper.
6. Commit + push to origin/main as part of "done" (per user memory).
