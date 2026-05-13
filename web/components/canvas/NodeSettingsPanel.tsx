"use client";

import { useNodes, useReactFlow, Panel } from "@xyflow/react";
import type { GenerationNodeData } from "@/types/nodes";
import { GENERATION_MODELS, DEFAULT_MODEL_ID } from "@/lib/models";

export function NodeSettingsPanel({ selectedNodeId }: { selectedNodeId: string }) {
  const nodes = useNodes();
  const { updateNodeData } = useReactFlow();

  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node) return null;

  const data = node.data as unknown as GenerationNodeData;
  const currentModel = data.model ?? DEFAULT_MODEL_ID;

  return (
    <Panel position="top-right">
      <div className="bg-white border border-stone-200 rounded-xl shadow-sm w-52 overflow-hidden">
        <div className="px-3 py-2 bg-stone-50 border-b border-stone-100">
          <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">Model</p>
        </div>
        <div className="p-2 space-y-1">
          {GENERATION_MODELS.map(m => {
            const active = currentModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => updateNodeData(selectedNodeId, { model: m.id })}
                className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                  active
                    ? "border-sage-300 bg-sage-50"
                    : "border-transparent hover:border-stone-200 hover:bg-stone-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-medium ${active ? "text-sage-800" : "text-stone-700"}`}>
                    {m.label}
                  </span>
                  <span className="text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded shrink-0">
                    {m.provider}
                  </span>
                </div>
                <p className="text-[10px] text-stone-400 mt-0.5">{m.note}</p>
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
