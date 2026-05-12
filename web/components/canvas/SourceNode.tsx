"use client";

import { memo, useCallback } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SourceNodeData } from "@/types/nodes";

export const SourceNode = memo(function SourceNode({ id, data }: NodeProps) {
  const d = data as unknown as SourceNodeData;
  const { deleteElements } = useReactFlow();

  const handleDelete = useCallback(() => {
    const genId = `gen-${d.filename}`;
    deleteElements({ nodes: [{ id }, { id: genId }] });
    try {
      const hidden: string[] = JSON.parse(localStorage.getItem("canvas-hidden-sources") ?? "[]");
      if (!hidden.includes(id)) {
        localStorage.setItem("canvas-hidden-sources", JSON.stringify([...hidden, id]));
      }
    } catch {}
  }, [id, d.filename, deleteElements]);

  return (
    <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm w-52 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700 truncate">{d.filename}</p>
          <Badge variant="secondary" className="mt-1 text-[10px]">
            {d.roomType.replace("_", " ")}
          </Badge>
        </div>
        <button
          onClick={handleDelete}
          className="ml-2 shrink-0 text-slate-300 hover:text-red-400 transition-colors nodrag"
          title="Remove from canvas"
        >
          <X size={14} />
        </button>
      </div>
      {d.photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={d.photoUrl}
          alt={d.filename}
          className="w-full h-32 object-cover"
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="photo"
        className="!w-3 !h-3 !bg-slate-400"
      />
    </div>
  );
});
