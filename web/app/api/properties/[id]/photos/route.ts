import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql, genId } from "@/lib/db";
import { storeInlineAsset } from "@/lib/storage";

function getUid(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

async function resolveProperty(propertyId: string, uid: string) {
  const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  const orgId = (userRows[0]?.default_org_id as string | null) ?? null;
  if (!orgId) return null;

  const rows = await sql`
    SELECT * FROM properties WHERE id = ${propertyId} AND org_id = ${orgId}
  `;
  return rows[0] ?? null;
}

// PATCH /api/properties/[id]/photos — assign a photo to a room (or unassign)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id: propertyId } = await params;
    const property = await resolveProperty(propertyId, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();

    // Bulk position update: { positions: [{ id, position }] }
    if (Array.isArray(body.positions)) {
      const positions = body.positions as Array<{ id: string; position: number }>;
      await Promise.all(
        positions.map(({ id, position }) =>
          sql`UPDATE property_photos SET position = ${position} WHERE id = ${id} AND property_id = ${propertyId}`
        )
      );
      return NextResponse.json({ ok: true });
    }

    const photoId: string | undefined = body.photoId;
    if (!photoId) return NextResponse.json({ error: "photoId is required" }, { status: 400 });

    const roomId: string | null = body.roomId ?? null;
    await sql`
      UPDATE property_photos SET room_id = ${roomId}
      WHERE id = ${photoId} AND property_id = ${propertyId}
    `;

    // Sync unified assets table (asset id uses deterministic prefix)
    await sql`
      UPDATE assets SET room_id = ${roomId}
      WHERE id = ${"ast_pp_" + photoId} AND property_id = ${propertyId}
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/properties/[id]/photos — remove a photo from this property
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id: propertyId } = await params;
    const property = await resolveProperty(propertyId, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const photoId: string | undefined = body.photoId;
    if (!photoId) return NextResponse.json({ error: "photoId is required" }, { status: 400 });

    await sql`
      DELETE FROM property_photos
      WHERE id = ${photoId} AND property_id = ${propertyId}
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/properties/[id]/photos]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/properties/[id]/photos — add a photo (already in photos table) to this property
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const uid = getUid(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id: propertyId } = await params;
    const property = await resolveProperty(propertyId, uid);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const filename: string | undefined = body.filename;
    if (!filename) {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }
    const roomId: string | null = typeof body.roomId === "string" ? body.roomId : null;

    // Verify the photo exists and belongs to this user
    const photoRows = await sql`
      SELECT filename, room_type, zone, mime_type, image_url, original_url, image_b64
      FROM photos
      WHERE filename = ${filename} AND user_id = ${uid}
    `;
    if (!photoRows[0]) {
      return NextResponse.json(
        { error: `Photo not found or not owned by you: ${filename}` },
        { status: 404 }
      );
    }
    const photo = photoRows[0];

    // Determine position (append to end)
    const countRows = await sql`
      SELECT COUNT(*) AS cnt FROM property_photos WHERE property_id = ${propertyId}
    `;
    const position = Number((countRows[0] as { cnt: unknown })?.cnt ?? 0);

    const id = genId();
    await sql`
      INSERT INTO property_photos (id, property_id, photo_filename, room_type, zone, is_hero, position, room_id)
      VALUES (
        ${id},
        ${propertyId},
        ${filename},
        ${(photo.room_type as string | null) ?? null},
        ${(photo.zone as string | null) ?? null},
        false,
        ${position},
        ${roomId}
      )
    `;

    // Dual-write to unified assets table
    const assetId = "ast_pp_" + id;
    const orgId = property.org_id as string;
    let assetBlobUrl = (photo.image_url as string | null) ?? null;

    // Dev fallback: if no blob URL, store the base64 inline so the asset survives reloads
    if (!assetBlobUrl && photo.image_b64) {
      assetBlobUrl = await storeInlineAsset(
        assetId,
        photo.image_b64 as string,
        (photo.mime_type as string | null) ?? "image/jpeg"
      );
    }

    if (assetBlobUrl) {
      await sql`
        INSERT INTO assets (id, org_id, property_id, room_id, kind, mime_type, blob_url, original_url,
                            zone, room_type, position, uploaded_by)
        VALUES (
          ${assetId},
          ${orgId},
          ${propertyId},
          ${roomId},
          'source',
          ${(photo.mime_type as string | null) ?? "image/jpeg"},
          ${assetBlobUrl},
          ${(photo.original_url as string | null) ?? null},
          ${(photo.zone as string | null) ?? null},
          ${(photo.room_type as string | null) ?? null},
          ${position},
          ${uid}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    const rows = await sql`
      SELECT id, property_id, photo_filename, room_type, zone, is_hero, position, room_id
      FROM property_photos WHERE id = ${id}
    `;

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/properties/[id]/photos]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
