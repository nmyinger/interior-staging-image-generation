import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  bigserial,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  type: text("type").$type<"solo" | "studio" | "brokerage">().notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  parentOrgId: text("parent_org_id").references((): AnyPgColumn => orgs.id),
  brand: jsonb("brand").$type<Record<string, unknown>>().default({}),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role")
      .$type<"owner" | "admin" | "member" | "client">()
      .notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.userId)]
);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .unique()
    .references(() => orgs.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  tier: text("tier").$type<"solo" | "studio" | "brokerage">().notNull(),
  status: text("status").notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  seatsPurchased: integer("seats_purchased").notNull().default(1),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: text("user_id"),
    kind: text("kind").$type<"generation" | "batch_generation">().notNull(),
    model: text("model"),
    costCents: integer("cost_cents").notNull().default(0),
    refId: text("ref_id"),
    billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("usage_events_org_period_idx").on(t.orgId, t.billingPeriodStart)]
);

// ---------------------------------------------------------------------------
// Properties & Photos
// ---------------------------------------------------------------------------

export const properties = pgTable("properties", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  clientOrgId: text("client_org_id").references(() => orgs.id),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  address: text("address"),
  mls: text("mls"),
  styleBrief: jsonb("style_brief").$type<Record<string, unknown>>().default({}),
  status: text("status")
    .$type<"draft" | "queued" | "analyzing" | "generating" | "done" | "failed">()
    .notNull()
    .default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const propertyPhotos = pgTable("property_photos", {
  id: text("id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  photoFilename: text("photo_filename")
    .notNull()
    .references(() => photos.filename),
  roomType: text("room_type"),
  zone: text("zone"),
  isHero: boolean("is_hero").notNull().default(false),
  position: integer("position").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export const batches = pgTable("batches", {
  id: text("id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  orgId: text("org_id")
    .notNull()
    .references(() => orgs.id),
  status: text("status").notNull().default("queued"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>(),
  catalog: jsonb("catalog").$type<Record<string, unknown>>(),
  model: text("model"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
});

export const batchItems = pgTable("batch_items", {
  id: text("id").primaryKey(),
  batchId: text("batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" }),
  propertyPhotoId: text("property_photo_id")
    .notNull()
    .references(() => propertyPhotos.id),
  status: text("status").notNull().default("queued"),
  stagedUrl: text("staged_url"),
  stagedRawUrl: text("staged_raw_url"),
  originalUrl: text("original_url").notNull().default(""),
  prompt: text("prompt"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export const disclosures = pgTable(
  "disclosures",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    propertyId: text("property_id").references(() => properties.id, {
      onDelete: "set null",
    }),
    batchItemId: text("batch_item_id").references(() => batchItems.id),
    shortCode: text("short_code").notNull().unique(),
    originalUrl: text("original_url").notNull(),
    stagedUrl: text("staged_url").notNull(),
    mls: text("mls"),
    watermarkConfig: jsonb("watermark_config")
      .$type<Record<string, unknown>>()
      .notNull(),
    disclosureText: text("disclosure_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("disclosures_org_created_idx").on(t.orgId, t.createdAt)]
);

export const mlsRules = pgTable("mls_rules", {
  code: text("code").primaryKey(),
  displayName: text("display_name").notNull(),
  jurisdiction: text("jurisdiction"),
  watermark: jsonb("watermark").$type<{
    text: string;
    position: string;
    sizePct: number;
    opacity: number;
  }>().notNull(),
  requiresOriginalUrl: boolean("requires_original_url").notNull().default(false),
  disclosureText: text("disclosure_text").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// API Access
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    scopes: text("scopes").array().default(["batches:write"]),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("api_keys_prefix_active_idx").on(t.keyPrefix)]
);

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().default(["batch.completed"]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id")
    .notNull()
    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: integer("status"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Stripe idempotency
// ---------------------------------------------------------------------------

export const stripeEventsProcessed = pgTable("stripe_events_processed", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Existing table references (not managed by this schema file — referenced only)
// These stubs allow foreign key references from the new tables above.
// The canonical definitions remain in lib/db.ts.
// ---------------------------------------------------------------------------

/**
 * Stub reference for the existing `users` table.
 * Only the columns needed for FK references are declared here.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  image: text("image").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  defaultOrgId: text("default_org_id"),
});

/**
 * Stub reference for the existing `photos` table.
 * Only the columns needed for FK references are declared here.
 */
export const photos = pgTable("photos", {
  filename: text("filename").primaryKey(),
  roomType: text("room_type").notNull().default("unknown"),
  zone: text("zone").notNull().default("unknown"),
  defaultPrompt: text("default_prompt").notNull().default(""),
  imageB64: text("image_b64"),
  mimeType: text("mime_type").notNull().default("image/jpeg"),
  userId: text("user_id").notNull().default(""),
  imageUrl: text("image_url"),
  orgId: text("org_id"),
  sha256: text("sha256"),
  originalUrl: text("original_url"),
});
