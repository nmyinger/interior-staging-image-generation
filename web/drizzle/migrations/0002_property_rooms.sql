-- Migration: 0002_property_rooms
-- Adds user-defined room definitions to properties, with per-room staging prompts.
-- Photos can be assigned to a room via room_id FK.

CREATE TABLE IF NOT EXISTS property_rooms (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL DEFAULT '',
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE property_photos ADD COLUMN IF NOT EXISTS room_id TEXT NULL REFERENCES property_rooms(id) ON DELETE SET NULL;
