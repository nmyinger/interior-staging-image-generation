"use client";

import { useRef, useState, useCallback } from "react";
import { Upload, Star, ImageIcon, Trash2, Loader2, Plus, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

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

interface PendingPreview {
  tempId: string;
  objectUrl: string;
  filename: string;
}

interface PhotoUploadGridProps {
  propertyId: string;
  photos: PropertyPhoto[];
  onPhotosChange: (photos: PropertyPhoto[]) => void;
  rooms: PropertyRoom[];
  onRoomsChange: (rooms: PropertyRoom[]) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function sizedUrl(url: string | null | undefined, w: number): string | null {
  if (!url) return null;
  if (!url.startsWith("http")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}width=${w}`;
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

export function PhotoUploadGrid({
  propertyId,
  photos,
  onPhotosChange,
  rooms,
  onRoomsChange,
}: PhotoUploadGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreview[]>([]);
  const [addingRoom, setAddingRoom] = useState(false);

  async function removePhoto(photoId: string) {
    const res = await fetch(`/api/properties/${propertyId}/photos`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId }),
    });
    if (res.ok) {
      onPhotosChange(photos.filter((p) => p.id !== photoId));
    }
  }

  async function assignPhotoToRoom(photoId: string, roomId: string | null) {
    const res = await fetch(`/api/properties/${propertyId}/photos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId, roomId }),
    });
    if (res.ok) {
      onPhotosChange(photos.map((p) => (p.id === photoId ? { ...p, room_id: roomId } : p)));
    }
  }

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
        onRoomsChange([...rooms, room]);
      }
    } finally {
      setAddingRoom(false);
    }
  }

  async function deleteRoom(roomId: string) {
    const res = await fetch(`/api/properties/${propertyId}/rooms/${roomId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onRoomsChange(rooms.filter((r) => r.id !== roomId));
      // Unassign all photos from this room
      onPhotosChange(photos.map((p) => (p.room_id === roomId ? { ...p, room_id: null } : p)));
    }
  }

  async function renameRoom(roomId: string, name: string) {
    if (!name.trim()) return;
    await fetch(`/api/properties/${propertyId}/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    onRoomsChange(rooms.map((r) => (r.id === roomId ? { ...r, name: name.trim() } : r)));
  }

  async function saveRoomPrompt(roomId: string, prompt: string) {
    await fetch(`/api/properties/${propertyId}/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    onRoomsChange(rooms.map((r) => (r.id === roomId ? { ...r, prompt } : r)));
  }

  async function uploadFiles(files: FileList) {
    if (!files.length) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;

    const newPreviews: PendingPreview[] = imageFiles.map((file, i) => ({
      tempId: `${Date.now()}-${i}`,
      objectUrl: URL.createObjectURL(file),
      filename: file.name,
    }));
    setPendingPreviews((prev) => [...prev, ...newPreviews]);
    setUploading(true);

    try {
      const newPhotos: PropertyPhoto[] = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        let blobUrl: string | null = null;
        try {
          blobUrl = await uploadFileToBlob(file, filename);
        } catch (err) {
          console.error("Client-side blob upload failed, falling back to base64", err);
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
          body: JSON.stringify({ filename }),
        });
        if (!attachRes.ok) {
          toast.error(`Failed to attach "${file.name}" to property`);
          continue;
        }
        const attached = await attachRes.json();
        newPhotos.push({ ...attached, image_url: blobUrl ?? null, original_url: null, room_id: null });
      }

      const previewIds = new Set(newPreviews.map((p) => p.tempId));
      setPendingPreviews((prev) => prev.filter((p) => !previewIds.has(p.tempId)));
      newPreviews.forEach((p) => setTimeout(() => URL.revokeObjectURL(p.objectUrl), 100));
      if (newPhotos.length > 0) {
        onPhotosChange([...photos, ...newPhotos]);
      }
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
  }

  const totalCount = photos.length + pendingPreviews.length;
  const unassignedPhotos = photos.filter((p) => !p.room_id);
  const hasRooms = rooms.length > 0;

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed transition-colors ${
        dragOver ? "border-sage-400 bg-sage-50" : "border-stone-200 bg-stone-50/50"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <span className="text-xs text-stone-500 font-medium">
          {totalCount === 0 ? "No photos yet" : `${totalCount} photo${totalCount !== 1 ? "s" : ""}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={addRoom}
            disabled={addingRoom}
            className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-800 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {addingRoom ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Add room
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-xs text-sage-700 bg-sage-50 hover:bg-sage-100 border border-sage-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            <Upload size={13} />
            {uploading ? "Uploading…" : "Add photos"}
          </button>
        </div>
      </div>

      {/* Body */}
      {totalCount === 0 && !hasRooms ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-stone-400">
          <ImageIcon size={32} strokeWidth={1.25} />
          <span className="text-sm">Drop photos here or click Add photos</span>
        </div>
      ) : (
        <div className="divide-y divide-stone-100">
          {/* Room sections */}
          {rooms.map((room) => {
            const roomPhotos = photos.filter((p) => p.room_id === room.id);
            return (
              <RoomSection
                key={room.id}
                room={room}
                photos={roomPhotos}
                allRooms={rooms}
                onRemove={() => deleteRoom(room.id)}
                onRename={(name) => renameRoom(room.id, name)}
                onPromptSave={(prompt) => saveRoomPrompt(room.id, prompt)}
                onPhotoRemoveFromRoom={(photoId) => assignPhotoToRoom(photoId, null)}
                onPhotoDelete={removePhoto}
              />
            );
          })}

          {/* Unassigned photos */}
          {(unassignedPhotos.length > 0 || pendingPreviews.length > 0) && (
            <div className="p-4">
              {hasRooms && (
                <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide mb-3">
                  Unassigned
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {unassignedPhotos.map((photo) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    rooms={rooms}
                    onRemove={removePhoto}
                    onAssignRoom={(roomId) => assignPhotoToRoom(photo.id, roomId)}
                  />
                ))}
                {pendingPreviews.map((p) => (
                  <UploadingCard key={p.tempId} preview={p} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state when rooms exist but no photos */}
          {totalCount === 0 && hasRooms && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-stone-400">
              <ImageIcon size={24} strokeWidth={1.25} />
              <span className="text-xs">Drop photos here or click Add photos</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoomSection({
  room,
  photos,
  allRooms,
  onRemove,
  onRename,
  onPromptSave,
  onPhotoRemoveFromRoom,
  onPhotoDelete,
}: {
  room: PropertyRoom;
  photos: PropertyPhoto[];
  allRooms: PropertyRoom[];
  onRemove: () => void;
  onRename: (name: string) => void;
  onPromptSave: (prompt: string) => void;
  onPhotoRemoveFromRoom: (photoId: string) => void;
  onPhotoDelete: (photoId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(room.name);
  const [promptDraft, setPromptDraft] = useState(room.prompt);
  const nameRef = useRef<HTMLInputElement>(null);

  function startEditName() {
    setNameDraft(room.name);
    setEditingName(true);
    setTimeout(() => nameRef.current?.select(), 0);
  }

  function commitName() {
    setEditingName(false);
    if (nameDraft.trim() && nameDraft.trim() !== room.name) {
      onRename(nameDraft.trim());
    } else {
      setNameDraft(room.name);
    }
  }

  const handlePromptBlur = useCallback(() => {
    if (promptDraft !== room.prompt) {
      onPromptSave(promptDraft);
    }
  }, [promptDraft, room.prompt, onPromptSave]);

  const hasStaged = photos.some((p) => p.stagedUrl);

  return (
    <div className="p-4">
      {/* Room header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {editingName ? (
            <input
              ref={nameRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") { setEditingName(false); setNameDraft(room.name); }
              }}
              className="text-[11px] font-semibold text-stone-700 uppercase tracking-wide bg-transparent border-b border-sage-400 outline-none min-w-0"
              autoFocus
            />
          ) : (
            <button
              onClick={startEditName}
              className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide hover:text-stone-700 transition-colors text-left truncate"
              title="Click to rename"
            >
              {room.name}
            </button>
          )}
          <span className="text-[10px] text-stone-300 shrink-0">
            {photos.length} photo{photos.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={onRemove}
                className="flex items-center justify-center w-6 h-6 rounded-md text-stone-300 hover:text-clay-600 hover:bg-clay-50 transition-colors ml-2 shrink-0"
              >
                <X size={13} />
              </button>
            }
          />
          <TooltipContent>Remove room</TooltipContent>
        </Tooltip>
      </div>

      {/* Prompt textarea */}
      <div className="mb-3">
        <Textarea
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          onBlur={handlePromptBlur}
          placeholder={`What furniture goes in this room? e.g., modern sofa, floor lamp, coffee table…`}
          rows={2}
          className="resize-none text-xs text-stone-600 placeholder:text-stone-300 bg-stone-50 border-stone-200"
        />
      </div>

      {/* Photos in this room */}
      {photos.length === 0 ? (
        <p className="text-xs text-stone-300 italic py-2">No photos assigned — use the dropdown on a photo below</p>
      ) : (
        <>
          {(hasStaged || photos.some((p) => p.stagedUrl !== undefined)) && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Unfurnished</p>
              <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Furnished</p>
            </div>
          )}
          <div className="space-y-2">
            {photos.map((photo) => (
              <RoomPhotoRow
                key={photo.id}
                photo={photo}
                rooms={allRooms}
                onRemoveFromRoom={() => onPhotoRemoveFromRoom(photo.id)}
                onDelete={() => onPhotoDelete(photo.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RoomPhotoRow({
  photo,
  rooms,
  onRemoveFromRoom,
  onDelete,
}: {
  photo: PropertyPhoto;
  rooms: PropertyRoom[];
  onRemoveFromRoom: () => void;
  onDelete: () => void;
}) {
  const proxyUrl = `/api/photos/${encodeURIComponent(photo.photo_filename)}?w=600`;

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Unfurnished */}
      <div className="group relative rounded-lg overflow-hidden border border-stone-200 bg-white aspect-[4/3]">
        {photo.image_url || photo.original_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={proxyUrl} alt={photo.photo_filename} loading="lazy" decoding="async" className="w-full h-full object-cover" />
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
        {/* Actions: remove from room + delete */}
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={onRemoveFromRoom}
                  className="flex items-center justify-center w-6 h-6 rounded-md bg-white/90 border border-stone-200 text-stone-400 hover:text-stone-600 hover:bg-stone-50 backdrop-blur-sm transition-colors"
                >
                  <X size={10} />
                </button>
              }
            />
            <TooltipContent>Remove from room</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={onDelete}
                  className="flex items-center justify-center w-6 h-6 rounded-md bg-white/90 border border-stone-200 text-stone-400 hover:text-clay-600 hover:border-clay-300 hover:bg-clay-50 backdrop-blur-sm transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              }
            />
            <TooltipContent>Delete photo</TooltipContent>
          </Tooltip>
        </div>
        {photo.batchStatus && photo.batchStatus !== "done" && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <StatusBadge status={photo.batchStatus} />
          </div>
        )}
      </div>

      {/* Furnished */}
      <div className="rounded-lg overflow-hidden border border-stone-200 bg-stone-50 aspect-[4/3] flex items-center justify-center">
        {photo.stagedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sizedUrl(photo.stagedUrl, 600) ?? undefined} alt={`${photo.photo_filename} staged`} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-stone-300">
            <ImageIcon size={20} strokeWidth={1.25} />
            <span className="text-[10px]">Not staged</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoCard({
  photo,
  rooms,
  onRemove,
  onAssignRoom,
}: {
  photo: PropertyPhoto;
  rooms: PropertyRoom[];
  onRemove: (id: string) => void;
  onAssignRoom: (roomId: string) => void;
}) {
  const imageUrl = photo.stagedUrl
    ? sizedUrl(photo.stagedUrl, 600)
    : `/api/photos/${encodeURIComponent(photo.photo_filename)}?w=400`;

  return (
    <div className="group relative rounded-xl overflow-hidden border border-stone-200 bg-white shadow-sm">
      <div className="relative aspect-[4/3] bg-stone-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={photo.photo_filename} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon size={24} className="text-stone-300" strokeWidth={1.25} />
          </div>
        )}

        {photo.is_hero && (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-acacia-100/90 text-acacia-500 border border-acacia-200 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            <Star size={9} fill="currentColor" />
            Hero
          </span>
        )}

        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => onRemove(photo.id)}
                  className="flex items-center justify-center w-6 h-6 rounded-md bg-white/90 border border-stone-200 text-stone-400 hover:text-clay-600 hover:border-clay-300 hover:bg-clay-50 backdrop-blur-sm transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              }
            />
            <TooltipContent>Remove photo</TooltipContent>
          </Tooltip>
        </div>

        {photo.batchStatus === "done" && photo.stagedUrl && (
          <div className="absolute bottom-1.5 right-1.5">
            <StatusBadge status="done" />
          </div>
        )}
        {photo.batchStatus && photo.batchStatus !== "done" && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <StatusBadge status={photo.batchStatus} />
          </div>
        )}
      </div>

      <div className="px-2.5 py-2 flex items-center justify-between gap-1 min-w-0">
        <p className="text-[11px] text-stone-500 truncate flex-1" title={photo.photo_filename}>
          {photo.photo_filename.replace(/^\d+-/, "")}
        </p>
        {rooms.length > 0 && (
          <RoomAssignDropdown rooms={rooms} onAssign={onAssignRoom} />
        )}
      </div>
    </div>
  );
}

function RoomAssignDropdown({
  rooms,
  onAssign,
}: {
  rooms: PropertyRoom[];
  onAssign: (roomId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-0.5 text-[10px] text-stone-400 hover:text-stone-600 shrink-0 px-1 py-0.5 rounded hover:bg-stone-100 transition-colors outline-none">
        Move
        <ChevronDown size={9} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {rooms.map((room) => (
          <DropdownMenuItem key={room.id} onClick={() => onAssign(room.id)}>
            {room.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UploadingCard({ preview }: { preview: PendingPreview }) {
  return (
    <div className="relative rounded-xl overflow-hidden border border-stone-200 bg-white shadow-sm">
      <div className="relative aspect-[4/3] bg-stone-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.objectUrl} alt={preview.filename} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
          <Loader2 size={18} className="text-white animate-spin" />
        </div>
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[11px] text-stone-500 truncate" title={preview.filename}>{preview.filename}</p>
      </div>
    </div>
  );
}
