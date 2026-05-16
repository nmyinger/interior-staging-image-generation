"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { RoomCard } from "@/components/properties/RoomCard";
import type { PropertyPhoto, PropertyRoom } from "@/components/properties/RoomCard";
import { BatchPoller } from "@/components/properties/BatchProgress";
import type { BatchItem } from "@/components/properties/BatchProgress";
import { StatusBadge } from "@/components/properties/StatusBadge";
import type { PropertyStatus } from "@/components/properties/StatusBadge";
import {
  ArrowLeft,
  Loader2,
  Zap,
  PencilLine,
  Frame,
  Plus,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

interface PropertyData {
  id: string;
  name: string;
  address: string | null;
  mls: string | null;
  status: PropertyStatus;
  style_brief: Record<string, unknown>;
  created_at: string;
  photos: PropertyPhoto[];
  rooms: PropertyRoom[];
  latest_batch: {
    id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
  } | null;
}

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params.id as string;

  const [property, setProperty] = useState<PropertyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Photos and rooms
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [rooms, setRooms] = useState<PropertyRoom[]>([]);

  // Per-room batch state: roomId → batchId
  const [roomBatches, setRoomBatches] = useState<Record<string, string>>({});
  const [roomStaging, setRoomStaging] = useState<Record<string, boolean>>({});

  // All-rooms batch
  const [allBatchId, setAllBatchId] = useState<string | null>(null);
  const [allStaging, setAllStaging] = useState(false);

  // Drag-and-drop active photo
  const [activeDragPhoto, setActiveDragPhoto] = useState<PropertyPhoto | null>(null);

  // Canvases
  const [canvases, setCanvases] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [creatingCanvas, setCreatingCanvas] = useState(false);

  const [addingRoom, setAddingRoom] = useState(false);

  const initialized = useRef(false);

  const loadCanvases = useCallback(async () => {
    const res = await fetch(`/api/sessions?property_id=${propertyId}`);
    if (res.ok) {
      const data = await res.json();
      setCanvases(data.sessions ?? []);
    }
  }, [propertyId]);

  const createCanvas = useCallback(async () => {
    setCreatingCanvas(true);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: propertyId }),
    });
    if (res.ok) {
      const { id } = await res.json();
      router.push(`/canvas/${id}`);
    } else {
      setCreatingCanvas(false);
    }
  }, [propertyId, router]);

  const loadProperty = useCallback(async () => {
    try {
      const res = await fetch(`/api/properties/${propertyId}`);
      if (res.status === 401) { router.push("/"); return; }
      if (!res.ok) { setLoadError("Property not found."); setLoading(false); return; }
      const data: PropertyData = await res.json();
      setProperty(data);
      setPhotos(data.photos ?? []);
      setRooms(data.rooms ?? []);

      // Resume polling if there's an active all-property batch
      const lb = data.latest_batch;
      if (lb && lb.status !== "done" && lb.status !== "failed") {
        setAllBatchId(lb.id);
      }
    } catch {
      setLoadError("Failed to load property.");
    } finally {
      setLoading(false);
    }
  }, [propertyId, router]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadProperty();
      loadCanvases();
    }
  }, [loadProperty, loadCanvases]);

  // ── Name editing ────────────────────────────────────────────────────────────

  function startEditName() {
    setNameDraft(property?.name ?? "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }

  async function commitName() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === property?.name) return;
    setProperty((p) => (p ? { ...p, name: trimmed } : p));
    await fetch(`/api/properties/${propertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
  }

  // ── Room management ─────────────────────────────────────────────────────────

  async function addRoom() {
    setAddingRoom(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Room" }),
      });
      if (res.ok) {
        const room: PropertyRoom = await res.json();
        setRooms((prev) => [...prev, room]);
      }
    } finally {
      setAddingRoom(false);
    }
  }

  function handleRoomUpdate(updated: PropertyRoom) {
    setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function handleRoomDelete(roomId: string) {
    const res = await fetch(`/api/properties/${propertyId}/rooms/${roomId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      // Photos in this room lose their room assignment
      setPhotos((prev) => prev.map((p) => (p.room_id === roomId ? { ...p, room_id: null } : p)));
    }
  }

  // ── Photo management ────────────────────────────────────────────────────────

  function handlePhotoAdd(photo: PropertyPhoto) {
    setPhotos((prev) => [...prev, photo]);
  }

  async function handlePhotoRemove(photoId: string) {
    const res = await fetch(`/api/properties/${propertyId}/photos`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId }),
    });
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    }
  }

  // ── Drag and drop ───────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const photo = photos.find((p) => p.id === event.active.id);
    setActiveDragPhoto(photo ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragPhoto(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const photoId = active.id as string;
    const overId = over.id as string;

    const sourcePhoto = photos.find((p) => p.id === photoId);
    if (!sourcePhoto) return;

    const targetIsRoom = rooms.some((r) => r.id === overId);
    const targetPhoto = !targetIsRoom ? photos.find((p) => p.id === overId) : null;
    const targetRoomId = targetIsRoom ? overId : (targetPhoto?.room_id ?? null);

    if (!targetRoomId) return;

    if (sourcePhoto.room_id === targetRoomId) {
      // ── Same room: reorder ──────────────────────────────────────────────
      if (!targetPhoto) return; // dropped on room droppable, same room — no-op
      const roomPhotos = photos.filter((p) => p.room_id === sourcePhoto.room_id);
      const oldIndex = roomPhotos.findIndex((p) => p.id === photoId);
      const newIndex = roomPhotos.findIndex((p) => p.id === overId);
      if (oldIndex === newIndex) return;

      const reordered = arrayMove(roomPhotos, oldIndex, newIndex).map((p, i) => ({
        ...p,
        position: i,
      }));
      setPhotos((prev) => [
        ...prev.filter((p) => p.room_id !== sourcePhoto.room_id),
        ...reordered,
      ]);
      await fetch(`/api/properties/${propertyId}/photos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: reordered.map((p) => ({ id: p.id, position: p.position })),
        }),
      });
    } else {
      // ── Different room: move ────────────────────────────────────────────
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, room_id: targetRoomId } : p))
      );
      await fetch(`/api/properties/${propertyId}/photos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId, roomId: targetRoomId }),
      });
    }
  }

  // ── Staging ─────────────────────────────────────────────────────────────────

  async function stageRoom(roomId: string) {
    setRoomStaging((prev) => ({ ...prev, [roomId]: true }));
    try {
      const res = await fetch(`/api/properties/${propertyId}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to start staging");
        return;
      }
      const { batchId } = await res.json();
      // Immediately show "queued" in each photo's Furnished cell
      setPhotos((prev) =>
        prev.map((p) => (p.room_id === roomId ? { ...p, batchStatus: "queued" as const } : p))
      );
      setRoomBatches((prev) => ({ ...prev, [roomId]: batchId }));
      setProperty((p) => (p ? { ...p, status: "queued" } : p));
    } finally {
      setRoomStaging((prev) => ({ ...prev, [roomId]: false }));
    }
  }

  async function stageAll() {
    if (photos.length === 0) return;
    setAllStaging(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to start staging");
        return;
      }
      const { batchId } = await res.json();
      setPhotos((prev) => prev.map((p) => ({ ...p, batchStatus: "queued" as const })));
      setAllBatchId(batchId);
      setProperty((p) => (p ? { ...p, status: "queued" } : p));
    } finally {
      setAllStaging(false);
    }
  }

  // Called by BatchPoller on every poll cycle — updates per-photo status in real time
  function handleBatchUpdate(items: BatchItem[]) {
    setPhotos((prev) =>
      prev.map((photo) => {
        const item = items.find((i) => i.photo_filename === photo.photo_filename);
        if (!item) return photo;
        return {
          ...photo,
          batchStatus: item.status as PropertyPhoto["batchStatus"],
          ...(item.staged_url ? { stagedUrl: item.staged_url } : {}),
        };
      })
    );
  }

  function handleRoomBatchComplete(roomId: string, items: BatchItem[]) {
    setPhotos((prev) =>
      prev.map((photo) => {
        const match = items.find((i) => i.photo_filename === photo.photo_filename);
        if (match?.staged_url) return { ...photo, stagedUrl: match.staged_url, batchStatus: "done" as const };
        return photo;
      })
    );
    setRoomBatches((prev) => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
    setProperty((p) => (p ? { ...p, status: "done" } : p));
    autoCreateCanvas(items);
  }

  function handleAllBatchComplete(items: BatchItem[]) {
    setPhotos((prev) =>
      prev.map((photo) => {
        const match = items.find((i) => i.photo_filename === photo.photo_filename);
        if (match?.staged_url) return { ...photo, stagedUrl: match.staged_url, batchStatus: "done" as const };
        return photo;
      })
    );
    setAllBatchId(null);
    setProperty((p) => (p ? { ...p, status: "done" } : p));
    autoCreateCanvas(items);
  }

  async function autoCreateCanvas(items: BatchItem[]) {
    const stagedItems = items.filter((i) => i.staged_url);
    if (!stagedItems.length) return;
    try {
      const sessionRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId }),
      });
      if (!sessionRes.ok) return;
      const { id: newSessionId } = await sessionRes.json();

      const nodes: Array<{ id: string; type: string; x: number; y: number; data: Record<string, unknown> }> = [];
      const edges: Array<{ id: string; source: string; sourceHandle: string; target: string; targetHandle: string }> = [];

      stagedItems.forEach((item, i) => {
        const y = i * 260;
        const sourceNodeId = crypto.randomUUID();
        const genNodeId = crypto.randomUUID();
        if (item.original_url) {
          nodes.push({ id: sourceNodeId, type: "photo", x: 50, y, data: { filename: item.photo_filename, photoUrl: item.original_url } });
          nodes.push({ id: genNodeId, type: "generation", x: 420, y, data: { prompt: "", status: "done", outputUrl: item.staged_url, outputImageUrl: item.staged_url } });
          edges.push({ id: crypto.randomUUID(), source: sourceNodeId, sourceHandle: "photo", target: genNodeId, targetHandle: "base" });
        } else {
          nodes.push({ id: genNodeId, type: "generation", x: 50, y, data: { prompt: "", status: "done", outputUrl: item.staged_url, outputImageUrl: item.staged_url } });
        }
      });

      await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: newSessionId, nodes, edges }),
      });

      const listRes = await fetch(`/api/sessions?property_id=${propertyId}`);
      if (listRes.ok) {
        const data = await listRes.json();
        setCanvases(data.sessions ?? []);
      }
      toast.success("Canvas created with your staged results");
    } catch {
      // best-effort
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-stone-300" />
      </div>
    );
  }

  if (loadError || !property) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-stone-500">{loadError ?? "Property not found."}</p>
        <Link href="/properties" className="text-sm text-sage-600 hover:underline">Back to properties</Link>
      </div>
    );
  }

  const anyRoomBatchRunning = Object.keys(roomBatches).length > 0;
  const allPhotosCount = photos.length;

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

        {/* Back link */}
        <Link
          href="/properties"
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 mb-5 transition-colors w-fit"
        >
          <ArrowLeft size={13} />
          Properties
        </Link>

        {/* Property header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {editingName ? (
                <input
                  ref={nameInputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="text-xl font-semibold text-stone-900 bg-transparent border-b-2 border-sage-400 outline-none"
                  autoFocus
                />
              ) : (
                <button onClick={startEditName} className="group flex items-center gap-2" title="Click to rename">
                  <h1 className="text-xl font-semibold text-stone-900">{property.name}</h1>
                  <PencilLine size={14} className="text-stone-300 group-hover:text-stone-500 transition-colors" />
                </button>
              )}
              {property.status !== "draft" && <StatusBadge status={property.status} />}
              {property.mls && (
                <span className="inline-flex items-center text-[11px] text-acacia-500 bg-acacia-100 border border-acacia-200 rounded-full px-2 py-0.5 font-medium">
                  {property.mls}
                </span>
              )}
            </div>
            {property.address && (
              <p className="text-xs text-stone-400 mt-1">{property.address}</p>
            )}
          </div>
        </div>

        {/* ── Rooms ──────────────────────────────────────────────────────────── */}
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragPhoto(null)}
        >
          <div className="space-y-4">
            {rooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 bg-white rounded-2xl border border-stone-200">
                <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center">
                  <ImageIcon size={18} strokeWidth={1.25} className="text-stone-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-stone-600">No rooms yet</p>
                  <p className="text-xs text-stone-400 mt-0.5">Add a room to start uploading and staging photos</p>
                </div>
                <button
                  onClick={addRoom}
                  disabled={addingRoom}
                  className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-4 py-2 transition-colors shadow-sm"
                >
                  {addingRoom ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Add room
                </button>
              </div>
            ) : (
              rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  photos={photos.filter((p) => p.room_id === room.id)}
                  propertyId={propertyId}
                  activeBatchId={roomBatches[room.id] ?? null}
                  staging={roomStaging[room.id] ?? false}
                  onPhotoAdd={handlePhotoAdd}
                  onPhotoRemove={handlePhotoRemove}
                  onRoomUpdate={handleRoomUpdate}
                  onRoomDelete={handleRoomDelete}
                  onStage={() => stageRoom(room.id)}
                />
              ))
            )}
          </div>

          {/* Drag overlay — ghost image while dragging */}
          <DragOverlay>
            {activeDragPhoto ? (
              <div className="w-40 rounded-lg overflow-hidden shadow-xl opacity-90 rotate-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/photos/${encodeURIComponent(activeDragPhoto.photo_filename)}?w=300`}
                  alt=""
                  className="w-full aspect-[4/3] object-cover"
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* ── Add room + Stage all ─────────────────────────────────────────── */}
        {rooms.length > 0 && (
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={addRoom}
              disabled={addingRoom}
              className="flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-stone-800 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg px-3 py-2 transition-colors"
            >
              {addingRoom ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add room
            </button>

            <button
              onClick={stageAll}
              disabled={allStaging || allBatchId !== null || anyRoomBatchRunning || allPhotosCount === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-4 py-2 transition-colors ml-auto"
            >
              {allStaging || allBatchId ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Zap size={12} />
              )}
              Stage all rooms
            </button>
          </div>
        )}

        {/* Headless pollers — one per active room batch + one for all-rooms */}
        {Object.entries(roomBatches).map(([roomId, batchId]) => (
          <BatchPoller
            key={batchId}
            batchId={batchId}
            onUpdate={handleBatchUpdate}
            onComplete={(items) => handleRoomBatchComplete(roomId, items)}
          />
        ))}
        {allBatchId && (
          <BatchPoller
            batchId={allBatchId}
            onUpdate={handleBatchUpdate}
            onComplete={handleAllBatchComplete}
          />
        )}

        {/* ── Canvases ─────────────────────────────────────────────────────── */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700">Canvases</h2>
            <button
              onClick={createCanvas}
              disabled={creatingCanvas}
              className="flex items-center gap-1.5 text-xs font-medium text-sage-700 hover:text-sage-900 bg-sage-50 hover:bg-sage-100 border border-sage-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              {creatingCanvas ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              New canvas
            </button>
          </div>

          {canvases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 bg-white rounded-2xl border border-stone-200">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center">
                <Frame size={18} strokeWidth={1.25} className="text-stone-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-stone-600">No canvases yet</p>
                <p className="text-xs text-stone-400 mt-0.5">Create a canvas for interactive, photo-by-photo staging</p>
              </div>
              <button
                onClick={createCanvas}
                disabled={creatingCanvas}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-4 py-2 transition-colors shadow-sm"
              >
                {creatingCanvas ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                New canvas
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {canvases.map((canvas) => (
                <Link
                  key={canvas.id}
                  href={`/canvas/${canvas.id}`}
                  className="flex items-center gap-3 bg-white rounded-xl border border-stone-200 hover:border-stone-300 hover:shadow-sm transition-all p-4 min-w-0"
                >
                  <div className="w-8 h-8 rounded-lg bg-sage-50 border border-sage-200 flex items-center justify-center shrink-0">
                    <Frame size={14} className="text-sage-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{canvas.name}</p>
                    <p className="text-[11px] text-stone-400">
                      {new Date(canvas.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
