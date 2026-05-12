"use client";

import { Upload, Loader2, Check, AlertCircle } from "lucide-react";

export interface PhotoItem {
  filename: string;
  thumbUrl: string;
  srcId: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

interface SidebarProps {
  photos: PhotoItem[];
  activeIds: Set<string>;
  uploading: boolean;
  saveState: SaveState;
  onUploadClick: () => void;
  onAddPhoto: (item: PhotoItem) => void;
}

export function Sidebar({
  photos,
  activeIds,
  uploading,
  saveState,
  onUploadClick,
  onAddPhoto,
}: SidebarProps) {
  return (
    <div className="w-52 h-full flex flex-col bg-stone-50 border-r border-stone-200 shrink-0">
      <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
        <span className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">
          Photos
        </span>
        <button
          onClick={onUploadClick}
          disabled={uploading}
          className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-sage-600 disabled:opacity-40 transition-colors rounded"
          title="Upload photo"
        >
          {uploading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {photos.length === 0 ? (
          <p className="text-[11px] text-stone-400 text-center pt-8">No photos yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {photos.map((item) => {
              const onCanvas = activeIds.has(item.srcId);
              return (
                <button
                  key={item.filename}
                  onClick={() => !onCanvas && onAddPhoto(item)}
                  disabled={onCanvas}
                  className={`relative aspect-square rounded-lg overflow-hidden bg-stone-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 ${
                    onCanvas
                      ? "opacity-25 cursor-default"
                      : "cursor-pointer hover:ring-2 hover:ring-sage-300"
                  }`}
                  title={item.filename}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 h-9 flex items-center shrink-0 border-t border-stone-200">
        {saveState === "saving" && (
          <Loader2 size={11} className="animate-spin text-stone-400" />
        )}
        {saveState === "saved" && (
          <Check size={11} className="text-moss-500" />
        )}
        {saveState === "error" && (
          <AlertCircle size={11} className="text-clay-400" />
        )}
      </div>
    </div>
  );
}
