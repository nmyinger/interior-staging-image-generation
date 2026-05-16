"use client";

import { useRef, useState, useCallback } from "react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import {
  Upload,
  Star,
  ImageIcon,
  Trash2,
  Loader2,
  X,
  Zap,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// ─── Shared types (exported for page.tsx) ────────────────────────────────────

export interface PropertyPhoto {
  id: string;
  photo_filename: string;
  room_type: string | null;
  zone: string | null;
  is_hero: boolean;
  position: number;
  room_id: string | null;
  image_url: string | null;
  original_url: string | null;
  batchStatus?: "queued" | "analyzing" | "generating" | "done" | "failed";
  stagedUrl?: string | null;
}

export interface PropertyRoom {
  id: string;
  name: string;
  prompt: string;
  position: number;
}

// ─── RoomCard ─────────────────────────────────────────────────────────────────

interface RoomCardProps {
  room: PropertyRoom;
  photos: PropertyPhoto[];
  propertyId: string;
  activeBatchId: string | null;
  staging: boolean;
  onPhotoAdd: (photo: PropertyPhoto) => void;
  onPhotoRemove: (photoId: string) => void;
  onRoomUpdate: (updated: PropertyRoom) => void;
  onRoomDelete: (roomId: string) => void;
  onStage: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadFileToBlob(file: File, filename: string): Promise<string | null> {
  const tokenRes = await fetch(`/api/photos/upload-token?filename=${encodeURIComponent(filename)}`);
  if (!tokenRes.ok) return null;
  const { token, pathname } = await tokenRes.json();
  const { put } = await import("@vercel/blob/client");
  const blob = await put(pathname, file, {
    access: "public",
    token,
    contentType: file.type,
    multipart: true,
  });
  return blob.url;
}

export function RoomCard({
  room,
  photos,
  propertyId,
  activeBatchId,
  staging,
  onPhotoAdd,
  onPhotoRemove,
  onRoomUpdate,
  onRoomDelete,
  onStage,
}: RoomCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(room.name);
  const [promptDraft, setPromptDraft] = useState(room.prompt);
  const [uploading, setUploading] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<
    { tempId: string; objectUrl: string }[]
  >([]);

  // @dnd-kit droppable — accepts photo rows dragged from other rooms
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: room.id });

  // ── Name editing ────────────────────────────────────────────────────────────

  function startEditName() {
    setNameDraft(room.name);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }

  async function commitName() {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === room.name) {
      setNameDraft(room.name);
      return;
    }
    onRoomUpdate({ ...room, name: trimmed });
    await fetch(`/api/properties/${propertyId}/rooms/${room.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
  }

  // ── Prompt editing ──────────────────────────────────────────────────────────

  const savePrompt = useCallback(async () => {
    if (promptDraft === room.prompt) return;
    onRoomUpdate({ ...room, prompt: promptDraft });
    await fetch(`/api/properties/${propertyId}/rooms/${room.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptDraft }),
    });
  }, [promptDraft, room, propertyId, onRoomUpdate]);

  // ── File upload ─────────────────────────────────────────────────────────────

  async function uploadFiles(files: FileList) {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;

    const previews = imageFiles.map((file, i) => ({
      tempId: `${Date.now()}-${i}`,
      objectUrl: URL.createObjectURL(file),
    }));
    setPendingPreviews((prev) => [...prev, ...previews]);
    setUploading(true);

    try {
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        let blobUrl: string | null = null;
        try {
          blobUrl = await uploadFileToBlob(file, filename);
        } catch (err) {
          console.error("Blob upload failed, falling back to base64", err);
        }

        const body = blobUrl
          ? { filename, mimeType: file.type, blobUrl }
          : { filename, mimeType: file.type, b64: await fileToBase64(file) };

        const uploadRes = await fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!uploadRes.ok) {
          toast.error(`Failed to upload "${file.name}"`);
          continue;
        }

        const attachRes = await fetch(`/api/properties/${propertyId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, roomId: room.id }),
        });
        if (!attachRes.ok) {
          toast.error(`Failed to attach "${file.name}" to room`);
          continue;
        }
        const attached = await attachRes.json();
        onPhotoAdd({ ...attached, image_url: blobUrl ?? null, original_url: null, room_id: room.id });
      }
    } finally {
      const previewIds = new Set(previews.map((p) => p.tempId));
      setPendingPreviews((prev) => prev.filter((p) => !previewIds.has(p.tempId)));
      previews.forEach((p) => setTimeout(() => URL.revokeObjectURL(p.objectUrl), 100));
      setUploading(false);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setFileDragOver(false);
    // Reject native image drags (browser populates uri-list, not Files)
    if (!e.dataTransfer.types.includes("Files")) return;
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }

  function handleFileDragOver(e: React.DragEvent) {
    // Only respond to file drags, not @dnd-kit pointer drags
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setFileDragOver(true);
    }
  }

  // ── Drop zone highlight ─────────────────────────────────────────────────────
  const dropBorderClass = isOver
    ? "border-sage-400 bg-sage-50/40"
    : fileDragOver
    ? "border-acacia-400 bg-acacia-50/40"
    : "border-stone-200 bg-stone-50/30";

  const hasPhotos = photos.length > 0 || pendingPreviews.length > 0;

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }}
      />

      {/* ── Card header ──────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-3">
        {/* Room name */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") { setEditingName(false); setNameDraft(room.name); }
              }}
              className="text-sm font-semibold text-stone-900 bg-transparent border-b-2 border-sage-400 outline-none min-w-0 max-w-48"
              autoFocus
            />
          ) : (
            <button
              onClick={startEditName}
              className="group flex items-center gap-1.5 text-left min-w-0"
              title="Click to rename"
            >
              <span className="text-sm font-semibold text-stone-800 truncate">{room.name}</span>
            </button>
          )}
          <span className="text-xs text-stone-400 shrink-0">
            · {photos.length} photo{photos.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Stage button */}
        <button
          onClick={onStage}
          disabled={staging || photos.length === 0 || activeBatchId !== null}
          className="flex items-center gap-1.5 text-xs font-medium text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 transition-colors shrink-0"
        >
          {staging || activeBatchId ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Zap size={12} />
          )}
          {activeBatchId ? "Staging…" : "Stage"}
        </button>

        {/* Remove room */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => onRoomDelete(room.id)}
                className="flex items-center justify-center w-6 h-6 rounded-md text-stone-300 hover:text-clay-600 hover:bg-clay-50 transition-colors shrink-0"
              >
                <X size={13} />
              </button>
            }
          />
          <TooltipContent>Remove room</TooltipContent>
        </Tooltip>
      </div>

      {/* ── Prompt ───────────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <Textarea
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          onBlur={savePrompt}
          placeholder="Describe the furniture for this room, e.g. modern sofa, floor lamp, oak coffee table with books…"
          rows={2}
          className="resize-none text-xs text-stone-600 placeholder:text-stone-300 bg-stone-50 border-stone-200"
        />
      </div>

      {/* ── Photo zone ───────────────────────────────────────────────────── */}
      <div
        ref={setDropRef}
        className={`mx-4 mb-4 rounded-xl border-2 border-dashed transition-colors ${dropBorderClass}`}
        onDragOver={handleFileDragOver}
        onDragLeave={() => setFileDragOver(false)}
        onDrop={handleFileDrop}
      >
        {/* Zone header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-stone-100">
          {hasPhotos ? (
            <div className="grid grid-cols-[20px_1fr_1fr_20px] gap-2 flex-1 mr-3">
              <div />
              <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Unfurnished</p>
              <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Furnished</p>
              <div />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-xs text-sage-700 bg-sage-50 hover:bg-sage-100 border border-sage-200 rounded-lg px-2.5 py-1 transition-colors shrink-0"
          >
            <Upload size={11} />
            {uploading ? "Uploading…" : "Add photos"}
          </button>
        </div>

        {/* Photo rows */}
        {hasPhotos ? (
          <div className="p-2 space-y-2">
            {photos.map((photo) => (
              <DraggablePhotoRow
                key={photo.id}
                photo={photo}
                onRemove={onPhotoRemove}
              />
            ))}
            {pendingPreviews.map((p) => (
              <UploadingRow key={p.tempId} objectUrl={p.objectUrl} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-stone-300">
            <ImageIcon size={28} strokeWidth={1.25} />
            <span className="text-xs">Drop photos here or click Add photos</span>
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Draggable photo row ──────────────────────────────────────────────────────

function blobProxyUrl(url: string | null | undefined, w: number): string | null {
  if (!url) return null;
  if (!url.startsWith("http")) return url;
  return `/api/blob-proxy?url=${encodeURIComponent(url)}&w=${w}`;
}

function DraggablePhotoRow({
  photo,
  onRemove,
}: {
  photo: PropertyPhoto;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: photo.id,
  });

  return (
    <div
      ref={setNodeRef}
      draggable={false}
      className={`grid grid-cols-[20px_1fr_1fr_20px] gap-2 items-center transition-opacity ${isDragging ? "opacity-30" : "opacity-100"}`}
    >
      {/* Drag handle */}
      <div
        {...listeners}
        {...attributes}
        className="flex items-center justify-center cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500 transition-colors rounded"
      >
        <GripVertical size={14} />
      </div>

      {/* Unfurnished */}
      <div className="relative rounded-lg overflow-hidden border border-stone-200 bg-white aspect-[4/3]">
        {photo.image_url || photo.original_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/photos/${encodeURIComponent(photo.photo_filename)}?w=600`}
            alt={photo.photo_filename}
            draggable={false}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={20} className="text-stone-300" strokeWidth={1.25} />
          </div>
        )}
        {photo.is_hero && (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-acacia-100/90 text-acacia-500 border border-acacia-200 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            <Star size={9} fill="currentColor" />
            Hero
          </span>
        )}
      </div>

      {/* Furnished */}
      <div className="rounded-lg overflow-hidden border border-stone-200 bg-stone-50 aspect-[4/3] flex items-center justify-center">
        {photo.stagedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={blobProxyUrl(photo.stagedUrl, 600) ?? undefined}
            alt={`${photo.photo_filename} staged`}
            draggable={false}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : photo.batchStatus && photo.batchStatus !== "done" && photo.batchStatus !== "failed" ? (
          <div className="flex flex-col items-center gap-2 text-sage-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-[10px]">
              {photo.batchStatus === "analyzing" ? "Analyzing…" : photo.batchStatus === "generating" ? "Generating…" : "Queued…"}
            </span>
          </div>
        ) : photo.batchStatus === "failed" ? (
          <div className="flex flex-col items-center gap-1.5 text-clay-400">
            <ImageIcon size={20} strokeWidth={1.25} />
            <span className="text-[10px]">Failed</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-stone-300">
            <ImageIcon size={20} strokeWidth={1.25} />
            <span className="text-[10px]">Not staged</span>
          </div>
        )}
      </div>

      {/* Delete */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={() => onRemove(photo.id)}
              className="flex items-center justify-center w-5 h-5 rounded text-stone-300 hover:text-clay-600 hover:bg-clay-50 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          }
        />
        <TooltipContent>Remove photo</TooltipContent>
      </Tooltip>
    </div>
  );
}

function UploadingRow({ objectUrl }: { objectUrl: string }) {
  return (
    <div className="grid grid-cols-[20px_1fr_1fr_20px] gap-2 items-center">
      <div />
      <div className="relative rounded-lg overflow-hidden border border-stone-200 bg-stone-100 aspect-[4/3]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={objectUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
          <Loader2 size={16} className="text-white animate-spin" />
        </div>
      </div>
      <div className="rounded-lg border border-stone-200 bg-stone-50 aspect-[4/3]" />
      <div />
    </div>
  );
}
