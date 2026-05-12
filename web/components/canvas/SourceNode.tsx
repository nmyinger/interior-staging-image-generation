"use client";

import { memo, useCallback } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
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
    <div className="relative bg-white border-2 border-stone-200 rounded-xl shadow-sm w-44 overflow-hidden group">
      {d.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={d.photoUrl}
          alt=""
          loading="lazy"
          className="w-full h-28 object-cover block"
        />
      ) : (
        <div className="w-full h-28 bg-stone-100" />
      )}
      <button
        onClick={handleDelete}
        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center text-stone-400 hover:text-clay-400 hover:bg-white transition-colors opacity-0 group-hover:opacity-100 nodrag"
        title="Remove from canvas"
      >
        <X size={11} />
      </button>
      <Handle
        type="source"
        position={Position.Right}
        id="photo"
        className="!w-3 !h-3 !bg-stone-400"
      />
    </div>
  );
});
