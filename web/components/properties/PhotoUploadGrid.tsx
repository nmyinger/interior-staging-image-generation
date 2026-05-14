"use client";

import { useRef, useState } from "react";
import { Upload, Star, ImageIcon } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

export interface PropertyPhoto {
  id: string;
  photo_filename: string;
  room_type: string | null;
  zone: string | null;
  is_hero: boolean;
  position: number;
  image_url: string | null;
  original_url: string | null;
  // batch item status for this photo — injected from parent when a batch is running
  batchStatus?: "queued" | "analyzing" | "generating" | "done" | "failed";
  stagedUrl?: string | null;
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

export function PhotoUploadGrid({
  propertyId,
  photos,
  onPhotosChange,
}: PhotoUploadGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFiles(files: FileList) {
    if (!files.length) return;
    setUploading(true);
    try {
      const newPhotos: PropertyPhoto[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        const b64 = await fileToBase64(file);
        const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        // 1. Upload to photos table
        const uploadRes = await fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, mimeType: file.type, b64 }),
        });
        if (!uploadRes.ok) {
          console.error("Photo upload failed", await uploadRes.text());
          continue;
        }

        // 2. Attach to property
        const attachRes = await fetch(`/api/properties/${propertyId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename }),
        });
        if (!attachRes.ok) {
          console.error("Attach photo failed", await attachRes.text());
          continue;
        }
        const attached = await attachRes.json();
        newPhotos.push({
          ...attached,
          image_url: null, // will be set after full page refresh/re-fetch
          original_url: null,
        });
      }
      onPhotosChange([...photos, ...newPhotos]);
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

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed transition-colors ${
        dragOver ? "border-sage-400 bg-sage-50" : "border-stone-200 bg-stone-50/50"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
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

      {/* Upload button row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <span className="text-xs text-stone-500 font-medium">
          {photos.length === 0 ? "No photos yet" : `${photos.length} photo${photos.length !== 1 ? "s" : ""}`}
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

      {/* Grid */}
      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-stone-400">
          <ImageIcon size={32} strokeWidth={1.25} />
          <span className="text-sm">Drop photos here or click Add photos</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
          {photos.map((photo) => (
            <PhotoCard key={photo.id} photo={photo} />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoCard({ photo }: { photo: PropertyPhoto }) {
  const imageUrl = photo.stagedUrl ?? photo.image_url ?? photo.original_url;

  return (
    <div className="group relative rounded-xl overflow-hidden border border-stone-200 bg-white shadow-sm">
      {/* Image */}
      <div className="relative aspect-[4/3] bg-stone-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={photo.photo_filename}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon size={24} className="text-stone-300" strokeWidth={1.25} />
          </div>
        )}

        {/* Overlay badges */}
        <div className="absolute top-1.5 left-1.5 flex gap-1">
          {photo.is_hero && (
            <span className="flex items-center gap-0.5 bg-acacia-100/90 text-acacia-500 border border-acacia-200 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
              <Star size={9} fill="currentColor" />
              Hero
            </span>
          )}
        </div>

        {/* Staged indicator overlay */}
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

      {/* Footer */}
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
