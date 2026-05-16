import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
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

export const propertyRooms = pgTable("property_rooms", {
  id: text("id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prompt: text("prompt").notNull().default(""),
  position: integer("position").notNull().default(0),
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
  roomId: text("room_id").references((): AnyPgColumn => propertyRooms.id, { onDelete: "set null" }),
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

// ---------------------------------------------------------------------------
// Unified schema (0003) — assets, generations, generation_inputs, canvas_layouts
// ---------------------------------------------------------------------------

export const rooms = pgTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("rooms_property_idx").on(t.propertyId, t.position)]
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    propertyId: text("property_id").references(() => properties.id, { onDelete: "cascade" }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    kind: text("kind").$type<"source" | "staged">().notNull(),
    sha256: text("sha256"),
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    width: integer("width"),
    height: integer("height"),
    blobUrl: text("blob_url").notNull(),
    originalUrl: text("original_url"),
    position: integer("position").notNull().default(0),
    isHero: boolean("is_hero").notNull().default(false),
    zone: text("zone"),
    roomType: text("room_type"),
    uploadedBy: text("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("assets_property_room_idx").on(t.propertyId, t.roomId, t.position),
    index("assets_property_kind_idx").on(t.propertyId, t.kind),
  ]
);

export const generations = pgTable(
  "generations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    sourceAssetId: text("source_asset_id").references(() => assets.id, { onDelete: "set null" }),
    outputAssetId: text("output_asset_id").references(() => assets.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull().default(""),
    model: text("model"),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    parentGenerationId: text("parent_generation_id").references(
      (): AnyPgColumn => generations.id,
      { onDelete: "set null" }
    ),
    batchId: text("batch_id").references(() => batches.id, { onDelete: "set null" }),
    sequenceIndex: integer("sequence_index"),
    status: text("status")
      .$type<"idle" | "queued" | "running" | "done" | "failed">()
      .notNull()
      .default("idle"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("generations_property_idx").on(t.propertyId),
    index("generations_source_idx").on(t.sourceAssetId),
    index("generations_batch_seq_idx").on(t.batchId, t.sequenceIndex),
  ]
);

export const generationInputs = pgTable(
  "generation_inputs",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    role: text("role").$type<"base" | "reference" | "hero">().notNull(),
    ord: integer("ord").notNull().default(0),
  },
  (t) => [index("generation_inputs_gen_idx").on(t.generationId, t.role, t.ord)]
);

export const canvasLayouts = pgTable("canvas_layouts", {
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  entityKind: text("entity_kind").$type<"asset" | "generation">().notNull(),
  entityId: text("entity_id").notNull(),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
});

export const sessionsLegacy = pgTable("sessions_legacy", {
  sessionId: text("session_id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  wasScratch: boolean("was_scratch").notNull().default(false),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).defaultNow(),
});

export const assetInlineData = pgTable("asset_inline_data", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  dataB64: text("data_b64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
