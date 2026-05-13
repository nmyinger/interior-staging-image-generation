"use client";

import { memo, useCallback } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import type { PhotoNodeData } from "@/types/nodes";

export const SourceNode = memo(function SourceNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PhotoNodeData;
  const { deleteElements } = useReactFlow();

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [id, deleteElements]);

  return (
    <div className={`relative bg-white border-2 ${selected ? "border-sage-400 ring-2 ring-sage-200" : "border-stone-200"} rounded-xl shadow-sm w-44 group transition-[border-color,box-shadow]`}>
      <div className="overflow-hidden rounded-xl">
        {d.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d.photoUrl}
            alt=""
            loading="lazy"
            className="w-full h-28 object-cover block"
          />
        ) : (
          <div className="w-full h-28 bg-stone-100 flex items-center justify-center">
            <span className="text-xs text-stone-400">No image</span>
          </div>
        )}
      </div>
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
        className="!w-4 !h-4 !bg-stone-400 !border-2 !border-white"
      />
    </div>
  );
});
