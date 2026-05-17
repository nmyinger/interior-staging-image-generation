# Interior Staging — AI Virtual Staging for Real Estate

An AI-powered virtual staging platform that transforms empty room photos into furnished, magazine-quality images using Google Gemini. Built for real estate photographers and brokerages.

This repo is a full-stack SaaS product — a Python batch pipeline for offline processing and a Next.js web app for the interactive, multi-tenant product.

---

## What it does

Upload photos of empty or unfurnished rooms. The AI analyzes the space, generates a furniture manifest that fits the style and dimensions, and produces a staged version of each photo. Results can be used for MLS listings, with built-in compliance tools for California's AB 723 disclosure requirement (watermarking + public disclosure URLs).

**Two independent surfaces:**

- **Python pipeline** (`pipeline/`) — batch-process a folder of photos from the command line. Great for one-off jobs or running the AI locally without standing up a server.
- **Next.js web app** (`web/`) — full SaaS product with auth, multi-tenant orgs, property/room organization, Stripe billing, canvas editor, compliance tools, and a REST API.

---

## Tech stack

Understanding *why* each tool exists helps you learn the patterns behind shipping a real product.

| Layer | Tool | Why this one |
|---|---|---|
| Framework | Next.js 16 (App Router) | Full-stack React — server components, API routes, and pages in one repo |
| Database | Neon Postgres (serverless) | Postgres that scales to zero; no connection pool to manage |
| ORM | Drizzle | Type-safe SQL queries and schema-driven migrations |
| Auth | next-auth v4 | Handles OAuth (Google) and sessions; battle-tested and framework-native |
| AI | Google Gemini | Multimodal — reads images and generates images in the same API |
| Storage | Vercel Blob | Edge-cached object storage; no S3 config required |
| Async jobs | Inngest | Durable background functions — batch jobs survive server restarts |
| Billing | Stripe | Industry standard; handles subscriptions, webhooks, and the customer portal |
| Rate limiting | Upstash Redis | Serverless Redis; used for per-user API rate limiting |
| Email | Resend | Transactional email with high deliverability |
| Canvas | React Flow (@xyflow/react) | Node-based graph editor for the interactive staging workspace |
| Styling | Tailwind CSS v4 + shadcn/ui | Utility-first CSS with a component library built on Base UI |
| Deployment | Vercel | Zero-config deploys for Next.js; integrates with Blob, env vars, etc. |

---

## Repository structure

```
interior-staging/
├── pipeline/          Python CLI — batch stages photos via Gemini
│   ├── main.py        Entry point
│   ├── analyze.py     Room classification + spatial analysis
│   ├── manifest.py    Furniture manifest generation
│   ├── stage.py       Image generation (zone-aware, cached)
│   └── config.py      Zone definitions, model names, file paths
│
├── web/               Next.js web app
│   ├── app/           Pages + API routes (App Router)
│   ├── components/    React components (canvas, properties, ui)
│   ├── lib/           Shared utilities — db, auth, billing, AI, storage
│   └── drizzle/       Schema + SQL migrations
│
├── Source Photos/     11 sample apartment JPEGs (pipeline input)
├── .env.example       Environment variable template (pipeline only)
└── prd.md             Product requirements document
```

---

## Part 1: Python pipeline

The pipeline is self-contained — you only need a Gemini API key and Python.

### How it works

The pipeline runs in three cached steps:

1. **Analyze** — Sends all photos to Gemini in one call. Classifies each room (bedroom, living room, kitchen, bathroom) and extracts spatial information. Result cached at `.cache/analysis.json`.
2. **Manifest** — Uses the analysis to generate a zone-wide furniture manifest: what pieces belong in each room, what style, what materials. Cached at `.cache/manifest.json`.
3. **Stage** — Generates a staged version of each photo using the manifest. Each output is cached individually, so a re-run only regenerates missing or changed photos.

Photos are grouped into three **zones** that share a consistent furniture set:
- `open_plan` — kitchen + living room
- `bedroom` — bedroom
- `bathroom_suite` — bathroom + closet

### Setup

**Prerequisites:** Python 3.8+, a [Google AI Studio](https://aistudio.google.com) account (free tier works).

```bash
# 1. Get a Gemini API key
# Go to https://aistudio.google.com → Get API key → Create API key
# Copy it.

# 2. Create a .env file in the project root
echo "GEMINI_API_KEY=your_key_here" > .env

# 3. Install dependencies
cd pipeline
pip install -r requirements.txt
```

### Run

```bash
# Stage all photos (skips already-staged outputs)
python3 main.py

# Force re-run everything from scratch
python3 main.py --force

# Stage only one zone
python3 main.py --zone open_plan    # or: bedroom, bathroom_suite
```

Outputs land in `outputs/{zone}/` as `{filename}_staged.jpg`.

**Cost:** ~$0.35 for a full 11-photo run. Re-runs with intact cache cost $0 for the analysis/manifest steps, only paying for any new image generations.

---

## Part 2: Web app

The web app is a production-grade SaaS product. Getting it running locally requires connecting several external services. This section explains each one and what it does.

### Services you'll need

Before writing any code, understand what you're setting up:

| Service | What it does | Free tier? |
|---|---|---|
| [Neon](https://neon.tech) | Hosts your Postgres database | Yes — 0.5 GB storage |
| [Vercel](https://vercel.com) | Hosts the app + stores images via Blob | Yes — generous hobby tier |
| [Google Cloud Console](https://console.cloud.google.com) | Provides OAuth "Sign in with Google" | Yes |
| [Stripe](https://stripe.com) | Handles billing and subscriptions | Yes — test mode is free |
| [Inngest](https://inngest.com) | Runs background batch jobs reliably | Yes |
| [Resend](https://resend.com) | Sends transactional emails | Yes — 100 emails/day |
| [Upstash](https://upstash.com) | Redis for API rate limiting | Yes — 10k requests/day |
| [Google AI Studio](https://aistudio.google.com) | Gemini API for image generation | Pay-per-use |

### Step 1 — Clone and install

```bash
git clone https://github.com/your-username/interior-staging-image-generation
cd interior-staging-image-generation/web
npm install
```

### Step 2 — Set up Vercel (required even for local dev)

Vercel manages your environment variables and hosts the Blob storage. Even when running locally, you pull secrets from Vercel rather than managing them by hand.

```bash
# Install Vercel CLI if you haven't
npm install -g vercel

# Link this project to a Vercel project (creates one if needed)
vercel link

# Pull all environment variables into .env.local
vercel env pull .env.local --yes
```

If you're setting up from scratch (not cloning from an existing Vercel project), create a `.env.local` manually and fill in each key as you complete the steps below.

### Step 3 — Set up Neon (database)

1. Create an account at [neon.tech](https://neon.tech)
2. Create a new project → copy the connection string
3. Add to `.env.local`:
   ```
   DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
   ```
4. Run migrations to create all tables:
   ```bash
   npm run db:migrate
   ```
   
   You can inspect the database visually with:
   ```bash
   npm run db:studio
   # Opens a web UI at http://localhost:4983
   ```

> **What migrations are:** Migrations are SQL files that describe how your database schema should change over time. Drizzle generates them from your TypeScript schema in `lib/schema.ts`. Running `db:migrate` applies any unapplied ones in order. Never edit the database manually — always change the schema file and generate a migration.

### Step 4 — Set up Google OAuth

This lets users sign in with their Google account.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the "Google+ API" or "People API"
4. Go to **Credentials → Create credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized redirect URIs: add `http://localhost:3000/api/auth/callback/google`
7. Copy the Client ID and Client Secret
8. Add to `.env.local`:
   ```
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="any-random-string-you-generate"
   ```
   
   Generate `NEXTAUTH_SECRET` with: `openssl rand -base64 32`

### Step 5 — Set up Vercel Blob (image storage)

Vercel Blob stores uploaded and generated images. When you ran `vercel link`, a `BLOB_READ_WRITE_TOKEN` should have been added automatically. If not:

1. Go to your Vercel project dashboard → **Storage → Create Store → Blob**
2. Copy the read-write token
3. Add to `.env.local`:
   ```
   BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
   ```

> **Why not just store images locally?** Local files disappear when the server restarts or scales to multiple instances. Object storage (like Vercel Blob, AWS S3, or Cloudflare R2) is persistent and serves files from a CDN edge close to the user.

### Step 6 — Set up Stripe (billing)

Even in development you need Stripe configured so the billing pages render. Use **test mode** — no real money moves.

1. Create an account at [stripe.com](https://stripe.com) → switch to **Test mode**
2. Go to **Developers → API keys** → copy the secret key (starts with `sk_test_`)
3. Create three products with monthly and annual prices (Solo, Studio, Brokerage)
4. Copy each price ID (starts with `price_`)
5. Add to `.env.local`:
   ```
   STRIPE_SECRET_KEY="sk_test_..."
   STRIPE_WEBHOOK_SECRET="whsec_..."   # set up below
   STRIPE_PRICE_SOLO_MONTHLY="price_..."
   STRIPE_PRICE_SOLO_ANNUAL="price_..."
   STRIPE_PRICE_STUDIO_MONTHLY="price_..."
   STRIPE_PRICE_STUDIO_ANNUAL="price_..."
   STRIPE_PRICE_BROKERAGE_MONTHLY="price_..."
   STRIPE_PRICE_BROKERAGE_ANNUAL="price_..."
   ```
   
   For local Stripe webhooks, install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   # Copy the webhook signing secret it prints → STRIPE_WEBHOOK_SECRET
   ```

### Step 7 — Set up Inngest (background jobs)

Inngest runs the batch staging jobs reliably — if a job crashes mid-way, it resumes automatically.

1. Create an account at [inngest.com](https://www.inngest.com)
2. Copy your **Event Key** and **Signing Key** from the dashboard
3. Add to `.env.local`:
   ```
   INNGEST_EVENT_KEY="..."
   INNGEST_SIGNING_KEY="sk-inn-..."
   ```
   
   For local development, run the Inngest dev server in a separate terminal:
   ```bash
   npx inngest-cli@latest dev
   ```

> **Why not just use a setTimeout or setInterval?** Background jobs need to be durable — if your server restarts mid-job, a regular timer is lost. Inngest persists job state so it can retry and resume. For expensive AI calls that take minutes, this matters a lot.

### Step 8 — Set up Resend (email)

1. Create an account at [resend.com](https://resend.com)
2. Create an API key → copy it
3. Add to `.env.local`:
   ```
   RESEND_API_KEY="re_..."
   RESEND_FROM_DOMAIN="yourdomain.com"   # or use resend's onboarding domain for testing
   ```

### Step 9 — Set up Upstash Redis (rate limiting)

1. Create an account at [upstash.com](https://upstash.com) → **Create database → Redis**
2. Copy the REST URL and REST token
3. Add to `.env.local`:
   ```
   UPSTASH_REDIS_REST_URL="https://..."
   UPSTASH_REDIS_REST_TOKEN="..."
   ```

### Step 10 — Add the Gemini API key

```
GEMINI_API_KEY="AIzaSy..."
```

Get this from [aistudio.google.com](https://aistudio.google.com) → **Get API key**.

### Run the web app

```bash
npm run dev
# Open http://localhost:3000
```

Sign in with Google or register with email/password. Create a property, upload photos, assign rooms, and run a batch to see staging in action.

---

## Web app architecture

### Key pages

| Page | What it does |
|---|---|
| `/properties` | List and create properties (a property = a listing being staged) |
| `/canvas/[id]` | Interactive node-based staging workspace (React Flow) |
| `/quick-stage` | Stage a single photo without creating a property |
| `/admin` | Org settings, team, billing, API keys, compliance |
| `/v/[code]` | Public disclosure page — original + watermarked staged image |

### How the staging workflow works

```
Upload photos
    ↓
Assign photos to rooms (bedroom, kitchen, etc.)
    ↓
Create a batch → Gemini analyzes the layout and generates a furniture manifest
    ↓
Per-photo generation runs as a background Inngest job
    ↓
Results appear on the canvas; disclosure records created automatically
```

### Database schema overview

The schema lives in `web/lib/schema.ts` (Drizzle models) with migrations in `web/drizzle/migrations/`.

Core tables:
- `orgs` — multi-tenant organizations (solo/studio/brokerage tier)
- `org_members` — who belongs to which org and their role
- `billing_subscriptions` — mirrors Stripe subscription state
- `properties` — a property/listing being staged
- `property_rooms` — rooms within a property
- `property_photos` — photos assigned to a room
- `batches` / `batch_items` — a staging run and its per-photo results
- `disclosures` — AB 723 compliance records with watermarked images
- `api_keys` — external API access for integrations

### API

The app exposes a REST API at `/api/v1/` authenticated by API keys. Interactive docs are served at `/api/docs` when running the app.

---

## Deployment

The web app is designed for Vercel. Push to your main branch and Vercel auto-deploys.

```bash
# Deploy a preview build
vercel deploy

# Deploy to production
vercel deploy --prod
```

**Before deploying:**
- Add all environment variables to Vercel: **Project → Settings → Environment Variables**
- Or use the CLI: `vercel env add NAME`
- Update the Google OAuth redirect URI to your production domain
- Update `NEXTAUTH_URL` to your production URL
- Create a live Stripe webhook endpoint pointing to `https://yourdomain.com/api/webhooks/stripe`

> **What a "preview deployment" is:** Every push creates a unique preview URL (like `myapp-abc123.vercel.app`) that's isolated from production. Great for reviewing changes before they go live — share the URL with a teammate to get feedback without touching production.

---

## Development commands

```bash
# Start dev server
npm run dev

# Type check (run before committing)
npx tsc --noEmit

# Lint
npm run lint

# Database — apply migrations
npm run db:migrate

# Database — visual UI
npm run db:studio

# Database — push schema without a migration (prototyping only)
npm run db:push
```

---

## Learning resources

If this is your first time shipping a full-stack app, these are the concepts worth understanding:

- **[Next.js App Router](https://nextjs.org/docs/app)** — how server components, client components, and API routes work together
- **[Drizzle ORM](https://orm.drizzle.team/docs/overview)** — schema-first, type-safe database access
- **[NextAuth.js](https://next-auth.js.org/getting-started/introduction)** — auth for Next.js apps
- **[Stripe subscriptions](https://stripe.com/docs/billing/subscriptions/overview)** — how recurring billing and webhooks work
- **[Inngest](https://www.inngest.com/docs)** — durable background functions
- **[Neon serverless Postgres](https://neon.tech/docs/introduction)** — how serverless databases differ from traditional ones
- **[Vercel Blob](https://vercel.com/docs/storage/vercel-blob)** — file storage for serverless apps

---

## License

MIT
