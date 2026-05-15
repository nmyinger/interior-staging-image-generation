"use client";

import { useRef, useState } from "react";
import { Upload, Star, ImageIcon, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export interface PropertyPhoto {
  id: string;
  photo_filename: string;
  room_type: string | null;
  zone: string | null;
  is_hero: boolean;
  position: number;
  image_url: string | null;
  original_url: string | null;
  batchStatus?: "queued" | "analyzing" | "generating" | "done" | "failed";
  stagedUrl?: string | null;
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

async function uploadFileToBlob(
  file: File,
  filename: string
): Promise<string | null> {
  // Request a short-lived client token from the server
  const tokenRes = await fetch(
    `/api/photos/upload-token?filename=${encodeURIComponent(filename)}`
  );
  if (!tokenRes.ok) return null; // blob not configured — fall back to base64

  const { token, pathname } = await tokenRes.json();

  // Upload directly from the browser to Vercel Blob (no serverless body-size limit)
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
}: PhotoUploadGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreview[]>([]);

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

  async function uploadFiles(files: FileList) {
    if (!files.length) return;

    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!imageFiles.length) return;

    // Show local previews immediately
    const newPreviews: PendingPreview[] = imageFiles.map((file, i) => ({
      tempId: `${Date.now()}-${i}`,
      objectUrl: URL.createObjectURL(file),
      filename: file.name,
    }));
    setPendingPreviews(prev => [...prev, ...newPreviews]);
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
          const msg = await uploadRes.text().catch(() => "Unknown error");
          console.error("Photo upload failed", msg);
          toast.error(`Failed to upload "${file.name}"`);
          continue;
        }

        const attachRes = await fetch(`/api/properties/${propertyId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename }),
        });
        if (!attachRes.ok) {
          const msg = await attachRes.text().catch(() => "Unknown error");
          console.error("Attach photo failed", msg);
          toast.error(`Failed to attach "${file.name}" to property`);
          continue;
        }
        const attached = await attachRes.json();
        newPhotos.push({ ...attached, image_url: blobUrl ?? null, original_url: null });
      }

      // Remove all previews and surface real photos atomically
      const previewIds = new Set(newPreviews.map(p => p.tempId));
      setPendingPreviews(prev => prev.filter(p => !previewIds.has(p.tempId)));
      newPreviews.forEach(p => setTimeout(() => URL.revokeObjectURL(p.objectUrl), 100));
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

  const hasRoomTypes = photos.some((p) => p.room_type !== null);
  const hasStaged = photos.some((p) => p.stagedUrl);

  // Group photos by room when analysis has run
  const grouped: Record<string, PropertyPhoto[]> = {};
  if (hasRoomTypes) {
    for (const photo of photos) {
      const key = photo.room_type ?? "Other";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(photo);
    }
  }

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
          {photos.length === 0 && pendingPreviews.length === 0
            ? "No photos yet"
            : `${photos.length + pendingPreviews.length} photo${photos.length + pendingPreviews.length !== 1 ? "s" : ""}`}
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs text-sage-700 bg-sage-50 hover:bg-sage-100 border border-sage-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          <Upload size={13} />
          {uploading ? "Uploading…" : "Add photos"}
        </button>
      </div>

      {/* Body */}
      {photos.length === 0 && pendingPreviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-stone-400">
          <ImageIcon size={32} strokeWidth={1.25} />
          <span className="text-sm">Drop photos here or click Add photos</span>
        </div>
      ) : hasRoomTypes ? (
        // Grouped by room with before/after columns
        <div className="divide-y divide-stone-100">
          {Object.entries(grouped).map(([room, roomPhotos]) => (
            <RoomSection key={room} room={room} photos={roomPhotos} onRemove={removePhoto} />
          ))}
        </div>
      ) : hasStaged ? (
        // No room types yet but staging done — before/after flat layout
        <div className="p-4 space-y-1">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Unfurnished</p>
            <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Furnished</p>
          </div>
          {photos.map((photo) => (
            <BeforeAfterRow key={photo.id} photo={photo} onRemove={removePhoto} />
          ))}
        </div>
      ) : (
        // Default flat grid — upload and manage phase
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
          {photos.map((photo) => (
            <PhotoCard key={photo.id} photo={photo} onRemove={removePhoto} />
          ))}
          {pendingPreviews.map((p) => (
            <UploadingCard key={p.tempId} preview={p} />
          ))}
        </div>
      )}
    </div>
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

function RoomSection({
  room,
  photos,
  onRemove,
}: {
  room: string;
  photos: PropertyPhoto[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="p-4">
      <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-3">{room}</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Unfurnished</p>
        <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">Furnished</p>
      </div>
      <div className="space-y-2">
        {photos.map((photo) => (
          <BeforeAfterRow key={photo.id} photo={photo} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}

function BeforeAfterRow({
  photo,
  onRemove,
}: {
  photo: PropertyPhoto;
  onRemove: (id: string) => void;
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

function PhotoCard({ photo, onRemove }: { photo: PropertyPhoto; onRemove: (id: string) => void }) {
  // For staged images use the blob URL (no proxy for batch outputs).
  // For originals, route through the resize proxy so the browser gets a proper thumbnail.
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

        <div className="absolute top-1.5 left-1.5 flex gap-1">
          {photo.is_hero && (
            <span className="flex items-center gap-0.5 bg-acacia-100/90 text-acacia-500 border border-acacia-200 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
              <Star size={9} fill="currentColor" />
              Hero
            </span>
          )}
        </div>

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

      <div className="px-2.5 py-2">
        <p className="text-[11px] text-stone-500 truncate" title={photo.photo_filename}>
          {photo.photo_filename.replace(/^\d+-/, "")}
        </p>
        {(photo.room_type || photo.zone) && (
          <p className="text-[10px] text-stone-400 truncate mt-0.5">
            {[photo.room_type, photo.zone].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
