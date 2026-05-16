-- Migration: 0004_backfill
-- Migrates data from old canvas_nodes/sessions/property_photos into the unified model.
-- Safe to re-run — all inserts use ON CONFLICT DO NOTHING with deterministic IDs.
-- Run AFTER 0003_unified_schema.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend properties with link_access/password from their attached sessions
-- ---------------------------------------------------------------------------
UPDATE properties p
SET link_access         = s.link_access,
    share_password_hash = s.share_password_hash
FROM (
  SELECT DISTINCT ON (property_id)
    property_id, link_access, share_password_hash
  FROM sessions
  WHERE property_id IS NOT NULL
  ORDER BY property_id, created_at DESC
) s
WHERE p.id = s.property_id
  AND p.link_access = 'private';

-- ---------------------------------------------------------------------------
-- 2. Backfill rooms from property_rooms
-- ---------------------------------------------------------------------------
INSERT INTO rooms (id, property_id, name, prompt, position, created_at)
SELECT id, property_id, name, prompt, position, created_at
FROM property_rooms
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. sessions_legacy: sessions WITH property_id → map directly
-- ---------------------------------------------------------------------------
INSERT INTO sessions_legacy (session_id, property_id, was_scratch)
SELECT s.id, s.property_id, false
FROM sessions s
WHERE s.property_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM properties p WHERE p.id = s.property_id)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Standalone sessions (no property_id) → new kind='scratch' properties
-- ---------------------------------------------------------------------------
INSERT INTO properties (
  id, org_id, created_by, name, kind, status,
  link_access, share_password_hash, created_at
)
SELECT
  'p_' || s.id                                                     AS id,
  COALESCE(
    s.org_id,
    (SELECT default_org_id FROM users WHERE id = s.owner_user_id)
  )                                                                AS org_id,
  s.owner_user_id                                                  AS created_by,
  COALESCE(NULLIF(s.name, ''), 'Untitled')                         AS name,
  'scratch'                                                        AS kind,
  'draft'                                                          AS status,
  s.link_access,
  s.share_password_hash,
  s.created_at
FROM sessions s
WHERE s.property_id IS NULL
  AND COALESCE(
        s.org_id,
        (SELECT default_org_id FROM users WHERE id = s.owner_user_id)
      ) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Map standalone sessions → their new scratch property
INSERT INTO sessions_legacy (session_id, property_id, was_scratch)
SELECT s.id, 'p_' || s.id, true
FROM sessions s
WHERE s.property_id IS NULL
  AND EXISTS (SELECT 1 FROM properties p WHERE p.id = 'p_' || s.id)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. assets from property_photos (source uploads)
-- ---------------------------------------------------------------------------
INSERT INTO assets (
  id, org_id, property_id, room_id, kind,
  sha256, mime_type, blob_url, original_url,
  position, is_hero, zone, room_type, uploaded_by, created_at
)
SELECT
  'ast_pp_' || pp.id                                AS id,
  COALESCE(ph.org_id, p.org_id)                     AS org_id,
  pp.property_id,
  pp.room_id,
  'source'                                          AS kind,
  ph.sha256,
  COALESCE(ph.mime_type, 'image/jpeg'),
  COALESCE(ph.image_url, 'data:pending')            AS blob_url,
  ph.original_url,
  pp.position,
  pp.is_hero,
  pp.zone,
  pp.room_type,
  ph.user_id                                        AS uploaded_by,
  NOW()
FROM property_photos pp
JOIN photos ph ON ph.filename = pp.photo_filename
JOIN properties p ON p.id = pp.property_id
ON CONFLICT (id) DO NOTHING;

-- Store base64 fallback for photos that have no blob URL
INSERT INTO asset_inline_data (asset_id, mime_type, data_b64)
SELECT
  'ast_pp_' || pp.id,
  COALESCE(ph.mime_type, 'image/jpeg'),
  ph.image_b64
FROM property_photos pp
JOIN photos ph ON ph.filename = pp.photo_filename
WHERE ph.image_url IS NULL
  AND ph.image_b64 IS NOT NULL
  AND ph.image_b64 <> ''
  AND EXISTS (SELECT 1 FROM assets a WHERE a.id = 'ast_pp_' || pp.id)
ON CONFLICT (asset_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. assets from canvas photo nodes (source uploads in canvas sessions)
-- ---------------------------------------------------------------------------
INSERT INTO assets (
  id, org_id, property_id, room_id, kind,
  sha256, mime_type, blob_url, original_url,
  position, is_hero, zone, room_type, uploaded_by, created_at
)
SELECT DISTINCT ON (sl.property_id, ph.filename)
  'ast_cn_' || SUBSTRING(MD5(sl.property_id || ':' || ph.filename) FROM 1 FOR 12) AS id,
  COALESCE(ph.org_id, p.org_id)                                                    AS org_id,
  sl.property_id,
  NULL                                                                              AS room_id,
  'source'                                                                          AS kind,
  ph.sha256,
  COALESCE(ph.mime_type, 'image/jpeg'),
  COALESCE(ph.image_url, 'data:pending')                                           AS blob_url,
  ph.original_url,
  0                                                                                 AS position,
  false                                                                             AS is_hero,
  NULL                                                                              AS zone,
  NULL                                                                              AS room_type,
  ph.user_id                                                                        AS uploaded_by,
  cn.created_at
FROM canvas_nodes cn
JOIN sessions s         ON s.id = cn.session_id
JOIN sessions_legacy sl ON sl.session_id = cn.session_id
JOIN properties p       ON p.id = sl.property_id
JOIN photos ph          ON ph.filename = (cn.data->>'filename')
WHERE cn.type = 'photo'
  AND ph.filename IS NOT NULL
  -- skip if we already created this asset from property_photos
  AND NOT EXISTS (
    SELECT 1 FROM property_photos pp
    WHERE pp.property_id = sl.property_id AND pp.photo_filename = ph.filename
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. generations from canvas generation nodes
-- ---------------------------------------------------------------------------
INSERT INTO generations (
  id, org_id, property_id, room_id,
  source_asset_id, output_asset_id,
  prompt, model, config,
  parent_generation_id, batch_id, sequence_index,
  status, error, started_at, finished_at,
  created_by, created_at
)
SELECT
  'gen_cn_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12)     AS id,
  p.org_id,
  sl.property_id,
  NULL                                                  AS room_id,
  NULL                                                  AS source_asset_id,  -- linked below
  NULL                                                  AS output_asset_id,  -- linked below
  COALESCE(cn.data->>'prompt', '')                      AS prompt,
  COALESCE(cn.data->>'model', 'gemini-3.1-flash-image-preview') AS model,
  '{}'::jsonb                                           AS config,
  NULL, NULL, NULL,
  CASE
    WHEN cn.data->>'status' = 'done' THEN 'done'
    WHEN cn.data->>'status' = 'failed' THEN 'failed'
    ELSE 'idle'
  END                                                   AS status,
  NULL                                                  AS error,
  NULL                                                  AS started_at,
  cn.created_at                                         AS finished_at,
  s.owner_user_id                                       AS created_by,
  cn.created_at
FROM canvas_nodes cn
JOIN sessions s         ON s.id = cn.session_id
JOIN sessions_legacy sl ON sl.session_id = cn.session_id
JOIN properties p       ON p.id = sl.property_id
WHERE cn.type = 'generation'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. output assets for generation nodes that have output
-- ---------------------------------------------------------------------------
INSERT INTO assets (
  id, org_id, property_id, room_id, kind,
  sha256, mime_type, blob_url, original_url,
  position, is_hero, zone, room_type, uploaded_by, created_at
)
SELECT
  'ast_out_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12)  AS id,
  p.org_id,
  sl.property_id,
  NULL                                                AS room_id,
  'staged'                                            AS kind,
  NULL                                                AS sha256,
  'image/jpeg'                                        AS mime_type,
  COALESCE(
    cn.data->>'outputUrl',
    '/api/assets/ast_out_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12) || '/inline'
  )                                                   AS blob_url,
  NULL                                                AS original_url,
  0, false, NULL, NULL,
  s.owner_user_id                                     AS uploaded_by,
  cn.created_at
FROM canvas_nodes cn
JOIN sessions s         ON s.id = cn.session_id
JOIN sessions_legacy sl ON sl.session_id = cn.session_id
JOIN properties p       ON p.id = sl.property_id
WHERE cn.type = 'generation'
  AND (
    (cn.data->>'outputUrl') IS NOT NULL
    OR (cn.data->>'outputB64') IS NOT NULL
  )
ON CONFLICT (id) DO NOTHING;

-- Store base64 fallback for b64-only outputs
INSERT INTO asset_inline_data (asset_id, mime_type, data_b64)
SELECT
  'ast_out_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12),
  'image/jpeg',
  cn.data->>'outputB64'
FROM canvas_nodes cn
JOIN sessions_legacy sl ON sl.session_id = cn.session_id
WHERE cn.type = 'generation'
  AND (cn.data->>'outputUrl') IS NULL
  AND (cn.data->>'outputB64') IS NOT NULL
  AND EXISTS (SELECT 1 FROM assets a WHERE a.id = 'ast_out_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12))
ON CONFLICT (asset_id) DO NOTHING;

-- Link output_asset_id back onto generation rows
UPDATE generations g
SET output_asset_id = 'ast_out_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12)
FROM canvas_nodes cn
WHERE g.id = 'gen_cn_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12)
  AND cn.type = 'generation'
  AND (
    (cn.data->>'outputUrl') IS NOT NULL
    OR (cn.data->>'outputB64') IS NOT NULL
  )
  AND g.output_asset_id IS NULL;

-- ---------------------------------------------------------------------------
-- 9. generation_inputs from canvas_edges
-- ---------------------------------------------------------------------------

-- base edges → role='base'
INSERT INTO generation_inputs (generation_id, asset_id, role, ord)
SELECT
  'gen_cn_' || SUBSTRING(MD5(ce.target) FROM 1 FOR 12)  AS generation_id,
  CASE cn_src.type
    WHEN 'photo' THEN
      COALESCE(
        -- property_photos-sourced asset (preferred)
        (SELECT 'ast_pp_' || pp.id
         FROM property_photos pp
         JOIN sessions_legacy sl2 ON sl2.session_id = ce.session_id
         WHERE pp.photo_filename = (cn_src.data->>'filename')
           AND pp.property_id = sl2.property_id
         LIMIT 1),
        -- canvas-only photo asset fallback
        'ast_cn_' || SUBSTRING(MD5(sl.property_id || ':' || (cn_src.data->>'filename')) FROM 1 FOR 12)
      )
    WHEN 'generation' THEN
      'ast_out_' || SUBSTRING(MD5(ce.source) FROM 1 FOR 12)
    ELSE NULL
  END                                                   AS asset_id,
  'base'                                               AS role,
  0                                                    AS ord
FROM canvas_edges ce
JOIN sessions_legacy sl   ON sl.session_id = ce.session_id
JOIN canvas_nodes cn_src  ON cn_src.id = ce.source
WHERE ce.target_handle = 'base'
  AND EXISTS (
    SELECT 1 FROM generations g
    WHERE g.id = 'gen_cn_' || SUBSTRING(MD5(ce.target) FROM 1 FOR 12)
  )
ON CONFLICT DO NOTHING;

-- ref edges → role='reference'
INSERT INTO generation_inputs (generation_id, asset_id, role, ord)
SELECT
  'gen_cn_' || SUBSTRING(MD5(ce.target) FROM 1 FOR 12)  AS generation_id,
  CASE cn_src.type
    WHEN 'photo' THEN
      COALESCE(
        (SELECT 'ast_pp_' || pp.id
         FROM property_photos pp
         JOIN sessions_legacy sl2 ON sl2.session_id = ce.session_id
         WHERE pp.photo_filename = (cn_src.data->>'filename')
           AND pp.property_id = sl2.property_id
         LIMIT 1),
        'ast_cn_' || SUBSTRING(MD5(sl.property_id || ':' || (cn_src.data->>'filename')) FROM 1 FOR 12)
      )
    WHEN 'generation' THEN
      'ast_out_' || SUBSTRING(MD5(ce.source) FROM 1 FOR 12)
    ELSE NULL
  END                                                   AS asset_id,
  'reference'                                          AS role,
  (ROW_NUMBER() OVER (
    PARTITION BY ce.target ORDER BY ce.id
  ) - 1)::int                                          AS ord
FROM canvas_edges ce
JOIN sessions_legacy sl   ON sl.session_id = ce.session_id
JOIN canvas_nodes cn_src  ON cn_src.id = ce.source
WHERE ce.target_handle = 'ref'
  AND EXISTS (
    SELECT 1 FROM generations g
    WHERE g.id = 'gen_cn_' || SUBSTRING(MD5(ce.target) FROM 1 FOR 12)
  )
ON CONFLICT DO NOTHING;

-- Back-fill source_asset_id from base inputs
UPDATE generations g
SET source_asset_id = gi.asset_id
FROM generation_inputs gi
WHERE gi.generation_id = g.id
  AND gi.role = 'base'
  AND g.source_asset_id IS NULL;

-- ---------------------------------------------------------------------------
-- 10. canvas_layouts from canvas_nodes x/y
-- ---------------------------------------------------------------------------
-- Asset layouts (photo nodes)
INSERT INTO canvas_layouts (property_id, entity_kind, entity_id, x, y)
SELECT DISTINCT ON (sl.property_id,
  COALESCE(
    (SELECT 'ast_pp_' || pp.id
     FROM property_photos pp
     WHERE pp.photo_filename = (cn.data->>'filename')
       AND pp.property_id = sl.property_id
     LIMIT 1),
    'ast_cn_' || SUBSTRING(MD5(sl.property_id || ':' || (cn.data->>'filename')) FROM 1 FOR 12)
  )
)
  sl.property_id,
  'asset'::text,
  COALESCE(
    (SELECT 'ast_pp_' || pp.id
     FROM property_photos pp
     WHERE pp.photo_filename = (cn.data->>'filename')
       AND pp.property_id = sl.property_id
     LIMIT 1),
    'ast_cn_' || SUBSTRING(MD5(sl.property_id || ':' || (cn.data->>'filename')) FROM 1 FOR 12)
  ),
  cn.x,
  cn.y
FROM canvas_nodes cn
JOIN sessions_legacy sl ON sl.session_id = cn.session_id
WHERE cn.type = 'photo'
ON CONFLICT (property_id, entity_kind, entity_id) DO NOTHING;

-- Generation layouts
INSERT INTO canvas_layouts (property_id, entity_kind, entity_id, x, y)
SELECT
  sl.property_id,
  'generation'::text,
  'gen_cn_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12),
  cn.x,
  cn.y
FROM canvas_nodes cn
JOIN sessions_legacy sl ON sl.session_id = cn.session_id
WHERE cn.type = 'generation'
  AND EXISTS (
    SELECT 1 FROM generations g
    WHERE g.id = 'gen_cn_' || SUBSTRING(MD5(cn.id) FROM 1 FOR 12)
  )
ON CONFLICT (property_id, entity_kind, entity_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. assets from batch_items staged outputs
-- ---------------------------------------------------------------------------
INSERT INTO assets (
  id, org_id, property_id, room_id, kind,
  sha256, mime_type, blob_url, original_url,
  position, is_hero, zone, room_type, uploaded_by, created_at
)
SELECT
  'ast_bi_' || bi.id           AS id,
  b.org_id,
  b.property_id,
  NULL                         AS room_id,
  'staged'                     AS kind,
  NULL                         AS sha256,
  'image/jpeg'                 AS mime_type,
  COALESCE(bi.staged_url, bi.staged_raw_url, 'data:pending') AS blob_url,
  bi.original_url              AS original_url,
  pp.position,
  pp.is_hero,
  pp.zone,
  pp.room_type,
  NULL                         AS uploaded_by,
  COALESCE(bi.finished_at, NOW())
FROM batch_items bi
JOIN batches b           ON b.id = bi.batch_id
JOIN property_photos pp  ON pp.id = bi.property_photo_id
WHERE bi.staged_url IS NOT NULL OR bi.staged_raw_url IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- generations from batch_items
INSERT INTO generations (
  id, org_id, property_id, room_id,
  source_asset_id, output_asset_id,
  prompt, model, config,
  parent_generation_id, batch_id, sequence_index,
  status, error, started_at, finished_at,
  created_by, created_at
)
SELECT
  'gen_bi_' || bi.id           AS id,
  b.org_id,
  b.property_id,
  pp.room_id,
  'ast_pp_' || pp.id           AS source_asset_id,
  CASE
    WHEN bi.staged_url IS NOT NULL OR bi.staged_raw_url IS NOT NULL
    THEN 'ast_bi_' || bi.id
    ELSE NULL
  END                          AS output_asset_id,
  COALESCE(bi.prompt, '')      AS prompt,
  b.model,
  '{}'::jsonb,
  NULL, bi.batch_id,
  pp.position                  AS sequence_index,
  CASE bi.status
    WHEN 'done'     THEN 'done'
    WHEN 'failed'   THEN 'failed'
    WHEN 'queued'   THEN 'queued'
    ELSE 'idle'
  END,
  bi.error,
  bi.started_at,
  bi.finished_at,
  NULL                         AS created_by,
  COALESCE(bi.started_at, NOW())
FROM batch_items bi
JOIN batches b           ON b.id = bi.batch_id
JOIN property_photos pp  ON pp.id = bi.property_photo_id
ON CONFLICT (id) DO NOTHING;

-- base inputs for batch generations
INSERT INTO generation_inputs (generation_id, asset_id, role, ord)
SELECT
  'gen_bi_' || bi.id,
  'ast_pp_' || pp.id,
  'base',
  0
FROM batch_items bi
JOIN property_photos pp ON pp.id = bi.property_photo_id
WHERE EXISTS (SELECT 1 FROM generations g WHERE g.id = 'gen_bi_' || bi.id)
  AND EXISTS (SELECT 1 FROM assets a WHERE a.id = 'ast_pp_' || pp.id)
ON CONFLICT DO NOTHING;

COMMIT;
