"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import type { SourceNodeData } from "@/types/nodes";

export function SourceNode({ data }: NodeProps) {
  const d = data as unknown as SourceNodeData;
  return (
    <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm w-52 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
        <p className="text-xs font-semibold text-slate-700 truncate">{d.filename}</p>
        <Badge variant="secondary" className="mt-1 text-[10px]">
          {d.roomType.replace("_", " ")}
        </Badge>
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
}
