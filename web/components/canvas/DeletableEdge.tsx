"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";

export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge path={edgePath} style={style} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan w-4 h-4 bg-white border border-stone-300 rounded-full flex items-center justify-center text-stone-400 hover:text-clay-400 hover:border-clay-400 transition-colors shadow-sm"
            onClick={() => deleteElements({ edges: [{ id }] })}
          >
            <X size={8} strokeWidth={2.5} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
