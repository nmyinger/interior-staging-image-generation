@AGENTS.md

---

# Web App — Developer Reference

## Product

AI virtual staging for real estate photographers. Two surfaces:
- **Property workflow** — organize photos by room, run batch Gemini staging, auto-create canvases from results
- **Canvas** — interactive React Flow workspace for iterative, node-based staging

## Repo Map

```
web/
  app/              Next.js App Router — pages + API routes
  components/
    canvas/         React Flow nodes, inspector, toolbar
    properties/     RoomCard, BatchProgress/BatchPoller, StatusBadge
    ui/             shadcn components (Base UI, NOT Radix)
  lib/              Shared utilities — db, auth, billing, storage, AI models
  drizzle/          Schema (schema.ts) + SQL migrations
  docs/             Topic docs — load the relevant one before starting
```

## Load the Right Doc First

| Working on… | Read first |
|---|---|
| DB tables, schema changes, migrations | `docs/schema.md` |
| Which API routes exist and what they accept | `docs/api-routes.md` |
| Canvas — nodes, generation, sessions, history | `docs/canvas.md` |
| Property / room / upload / batch staging | `docs/staging-workflow.md` |
| Billing — Stripe, plans, quota enforcement | `docs/billing.md` |
| Disclosures, watermarks, E&O PDF, MLS rules | `docs/compliance.md` |

## Cross-Cutting Conventions

**Auth:** All API routes call `getServerSession(authOptions)` first and return 401 before touching the DB. External v1 routes use `withApiAuth()` from `lib/api-auth.ts` instead.

**Org resolution:** Every property/batch route resolves `uid → default_org_id → property (org check)` before acting on data. Follow any existing route as a pattern.

**Error shape:** `NextResponse.json({ error: string }, { status: N })`. Use `err instanceof Error ? err.message : String(err)` for caught errors.

**DB access:** Use `sql` tag from `lib/db.ts` for queries on legacy tables. New tables use Drizzle ORM (`lib/schema.ts`). Run `npm run db:migrate` after schema changes.

**ID generation:** `genId()` from `lib/db.ts` for all DB IDs. Never `crypto.randomUUID()`.

**Image serving:** Never put raw Vercel Blob URLs in `<img>` tags — route through `/api/photos/[filename]?w=N` (uploaded photos) or `/api/blob-proxy?url=<encoded>&w=N` (AI outputs). See `docs/staging-workflow.md` for width conventions.

**Components:** Always check `components/ui/` before writing from scratch. Extend with `npx shadcn add <component>` — do not hand-roll Base UI wrappers.

## Commands

```bash
npm run dev        # dev server (port 3000)
npm run build      # production build
npm run lint       # eslint
npx tsc --noEmit   # type check (run before every commit)
npm run db:migrate # run Drizzle migrations
npm run db:studio  # Drizzle Studio UI

# Pull env vars from Vercel:
vercel env pull .env.local --yes
```

## Hard Rules

- **Never use Radix UI** — the kit uses Base UI via shadcn. `@radix-ui/*` is not installed.
- **Never use violet / purple / indigo / blue** — earth-tone palette only. See `AGENTS.md`.
- **Never skip auth checks** — no bypassing `getServerSession`, no unauthenticated data access.
- **Never use `next/image`** for user photos — auth-gated images must go through the Sharp proxy.
- **Never write raw SQL for new tables** — add a Drizzle model to `lib/schema.ts` and run a migration.
- **Never trust `over` in drag handlers** — always check if `over.id` is a room or a photo before acting.
