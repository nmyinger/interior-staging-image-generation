# Bug Log

Bugs found during development, to be fixed in a future session.

| # | Area | Description | Priority |
|---|------|-------------|----------|
| 1 | ~~Canvas — Download Image~~ | **FIXED.** `handleDownload` in `NodeInspectorPanel.tsx` now `fetch()`es the Blob URL, creates a local `URL.createObjectURL()`, sets that as `a.href`, then revokes after click. `BatchProgress.tsx` download anchor converted to a button with the same fetch-based pattern. | ~~High~~ |
| 2 | ~~Billing page — Duplicate usage card~~ | **FIXED.** Merged into single `UsageSummaryCard` component that handles both free and paid states. | ~~Medium~~ |
| 3 | ~~Billing page — Usage always shows 0~~ | **FIXED.** Root cause: `usage_events.org_id` has a FK constraint to `orgs`, but the generate route was inserting `'user:{userId}'` for free users (no subscription = no real org ID). Fix: `app/api/generate/route.ts` now falls back to `getUserOrg()` so a real org_id is always written. `canGenerate` and `getSubscriptionDetails` both now filter `kind = 'generation'` for consistency. | ~~High~~ |
| 4 | ~~Billing page — Plans section layout/sizing~~ | **FIXED.** `TierCard` now uses `flex flex-col` with `CardContent flex-1` to pin footers. Grid uses `items-stretch`. Full page redesign combined with #2 fix. | ~~Medium~~ |
| 5 | ~~Admin area — No persistent navigation / "Back to canvas" misplaced~~ | **FIXED.** `app/admin/layout.tsx` and `app/properties/layout.tsx` added, both mounting `AppSidebar`. Nav-card grid and "Back to canvas" link removed from admin dashboard. All back-links removed from individual pages. | ~~High~~ |
| 6 | ~~Navigation — Sessions and Properties siloed away from admin area~~ | **FIXED.** Sidebar includes Sessions and Properties at the top of the Workspace section. `app/properties/layout.tsx` adds the sidebar to all properties pages. | ~~High~~ |
| 7 | ~~Information architecture — API Keys miscategorized~~ | **FIXED.** Sidebar groups: Workspace (Sessions, Properties) / Account (Compliance, Billing, Team, Settings, API Keys). All sections reachable from one panel. | ~~Medium~~ |
| 8 | ~~Multiple routes blocked — new users never get an org provisioned~~ | **FIXED.** `provisionPersonalOrg()` added to `lib/orgs.ts`. Called from `lib/auth.ts` `signIn` callback after user upsert, guarded on `default_org_id IS NULL`. `getUserOrg()` also lazy-provisions as a belt-and-suspenders backfill for existing users. | ~~Critical~~ |
| 9 | ~~Create client workspace — tier gate gives no upgrade path~~ | **FIXED.** `app/admin/team/new/page.tsx` now detects the "Studio or Brokerage" error response and shows an acacia-toned inline prompt with plan names, pricing, and a link to `/admin/billing`. | ~~Low~~ |
| 10 | ~~Settings page — three separate architectural problems~~ | **FIXED.** a) Resolved by #8. b) Resolved by #8. c) "Workspace Settings" renamed to "Settings" with updated subtitle. | ~~High~~ |
