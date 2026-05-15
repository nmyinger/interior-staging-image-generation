"use client";

import { memo, useCallback, useContext, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { Loader2, Sparkles, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SessionContext } from "./SessionContext";
import type { GenerationNodeData, NodeStatus } from "@/types/nodes";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { StatusDot } from "@/components/ui/status-dot";
import type { StatusDotTone } from "@/components/ui/status-dot";

function statusTone(status: NodeStatus): StatusDotTone {
  if (status === "done") return "moss";
  if (status === "generating") return "acacia";
  if (status === "error") return "clay";
  return "stone";
}

const HANDLE_BASE_STYLE = { top: "30%" };
const HANDLE_REF_STYLE = { top: "60%" };

export const GenerationNode = memo(function GenerationNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as GenerationNodeData;
  const { sessionId, readOnly } = useContext(SessionContext);
  const { updateNodeData } = useReactFlow();

  // Reactive: re-renders when any edge connecting this node's base handle changes
  const isBaseConnected = useStore(s =>
    s.edges.some(e => e.target === id && e.targetHandle === "base")
  );

  const [status, setStatus] = useState<NodeStatus>(d.status ?? "idle");
  const [outputUrl, setOutputUrl] = useState(d.outputImageUrl ?? "");
  const [error, setError] = useState(d.error ?? "");

  const generate = useCallback(async () => {
    if (!isBaseConnected) return;
    setStatus("generating");
    setError("");

    try {
      const nodeData = data as unknown as GenerationNodeData;
      const model = nodeData.model ?? DEFAULT_MODEL_ID;
      const currentPrompt = nodeData.prompt ?? "";
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: id, sessionId, prompt: currentPrompt, model }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Generation failed");

      const imageUrl: string = json.imageDataUrl;
      // imageDataUrl is either a blob URL (https://...) or legacy data URL (data:...)
      const isBlob = imageUrl.startsWith("https://");
      setOutputUrl(imageUrl);
      setStatus("done");
      if (isBlob) {
        updateNodeData(id, { outputUrl: imageUrl, outputImageUrl: imageUrl, status: "done", prompt: currentPrompt });
      } else {
        const b64 = imageUrl.replace(/^data:[^;]+;base64,/, "");
        updateNodeData(id, { outputB64: b64, outputImageUrl: imageUrl, status: "done", prompt: currentPrompt });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [id, sessionId, isBaseConnected, updateNodeData, data]);

  const buttonLabel =
    status === "error" ? "Retry"
    : status === "done" ? "Re-generate"
    : "Generate";

  return (
    <div className={`bg-white border-2 ${selected ? "border-sage-500 ring-2 ring-sage-200" : "border-sage-200"} rounded-[var(--radius-node)] shadow-sm w-64 overflow-hidden transition-[border-color,box-shadow]`}>
      <div className="px-3 py-2 bg-sage-50 border-b border-sage-200 flex items-center">
        <StatusDot tone={statusTone(status)} pulse={status === "generating"} />
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="base"
        style={HANDLE_BASE_STYLE}
        className="!w-4 !h-4 !bg-stone-400 !border-2 !border-white"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="ref"
        style={HANDLE_REF_STYLE}
        className="!w-4 !h-4 !bg-acacia-400 !border-2 !border-white"
      />

      <div className="p-3 space-y-2">
        {!isBaseConnected && (
          <div className="flex items-center gap-1.5 text-[10px] text-stone-400 py-0.5">
            <ImageIcon size={11} />
            Connect a photo node to generate
          </div>
        )}
        <Textarea
          value={d.prompt ?? ""}
          onChange={readOnly ? undefined : e => updateNodeData(id, { prompt: e.target.value })}
          readOnly={readOnly}
          placeholder={readOnly ? "" : "Describe the staging…"}
          className={`text-xs resize-none h-20 nodrag ${readOnly ? "cursor-default bg-stone-50 text-stone-500" : ""}`}
          onMouseDown={e => e.stopPropagation()}
        />
        {!readOnly && (
          <>
            <Button
              size="sm"
              className={`w-full text-white ${status === "error" ? "bg-clay-500 hover:bg-clay-600" : "bg-sage-600 hover:bg-sage-700"}`}
              onClick={generate}
              disabled={status === "generating" || !isBaseConnected}
            >
              {status === "generating" ? (
                <><Loader2 size={12} className="mr-1 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles size={12} className="mr-1" /> {buttonLabel}</>
              )}
            </Button>
            {status === "error" && (
              <p className="text-[10px] text-clay-500">{error}</p>
            )}
          </>
        )}
      </div>

      {outputUrl && (
        <div className="border-t border-sage-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={outputUrl} alt="staged" loading="lazy" className="w-full max-h-48 object-cover block" />
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-4 !h-4 !bg-sage-500 !border-2 !border-white"
      />
    </div>
  );
});
