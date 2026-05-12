"use client";

import { Panel } from "@xyflow/react";
import { Upload, Plus, Loader2, Check, AlertCircle } from "lucide-react";

type SaveState = "idle" | "saving" | "saved" | "error";

interface MenuBarProps {
  onUpload: () => void;
  onAddNode: () => void;
  uploading: boolean;
  saveState: SaveState;
}

export function MenuBar({ onUpload, onAddNode, uploading, saveState }: MenuBarProps) {
  return (
    <Panel position="bottom-center">
      <div className="flex items-center mb-6 bg-white border border-stone-200 rounded-2xl shadow-[0_4px_24px_-4px_rgba(0,0,0,0.10),0_1px_4px_-1px_rgba(0,0,0,0.06)]">
        <button
          onClick={onUpload}
          disabled={uploading}
          title="Upload photo"
          className="flex items-center gap-2 px-4 py-2.5 text-stone-500 hover:text-stone-800 hover:bg-stone-50/80 disabled:opacity-40 transition-all duration-150 rounded-l-2xl select-none"
        >
          {uploading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Upload size={15} />
          )}
          <span className="text-xs font-medium tracking-tight">Upload</span>
        </button>

        <div className="w-px h-5 bg-stone-200 shrink-0" />

        <button
          onClick={onAddNode}
          title="Add node"
          className="flex items-center gap-2 px-4 py-2.5 text-stone-500 hover:text-stone-800 hover:bg-stone-50/80 transition-all duration-150 rounded-r-2xl select-none"
        >
          <Plus size={15} />
          <span className="text-xs font-medium tracking-tight">Add Node</span>
        </button>

        {saveState !== "idle" && (
          <>
            <div className="w-px h-5 bg-stone-200 shrink-0" />
            <div className="px-3 py-2.5 flex items-center">
              {saveState === "saving" && <Loader2 size={11} className="animate-spin text-stone-400" />}
              {saveState === "saved" && <Check size={11} className="text-moss-500" />}
              {saveState === "error" && <AlertCircle size={11} className="text-clay-400" />}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
