"use client";

import { memo, useCallback, useContext, useState } from "react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { Loader2, Sparkles, Download, X, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SessionContext } from "./SessionContext";
import type { GenerationNodeData, NodeStatus } from "@/types/nodes";
import { DEFAULT_MODEL_ID } from "@/types/nodes";

function StatusDot({ status }: { status: NodeStatus }) {
  const cls =
    status === "done" ? "bg-moss-500"
    : status === "generating" ? "bg-acacia-400 animate-pulse"
    : status === "error" ? "bg-clay-400"
    : "bg-stone-300";
  return <div className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

const HANDLE_BASE_STYLE = { top: "30%" };
const HANDLE_REF_STYLE = { top: "60%" };

export const GenerationNode = memo(function GenerationNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as GenerationNodeData;
  const sessionId = useContext(SessionContext);
  const { deleteElements, updateNodeData } = useReactFlow();

  // Reactive: re-renders when any edge connecting this node's base handle changes
  const isBaseConnected = useStore(s =>
    s.edges.some(e => e.target === id && e.targetHandle === "base")
  );

  const [prompt, setPrompt] = useState(d.prompt ?? "");
  const [status, setStatus] = useState<NodeStatus>(d.status ?? "idle");
  const [outputUrl, setOutputUrl] = useState(d.outputImageUrl ?? "");
  const [error, setError] = useState(d.error ?? "");

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [id, deleteElements]);

  const generate = useCallback(async () => {
    if (!isBaseConnected) return;
    setStatus("generating");
    setError("");

    try {
      const model = (data as unknown as GenerationNodeData).model ?? DEFAULT_MODEL_ID;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: id, sessionId, prompt, model }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Generation failed");

      const dataUrl: string = json.imageDataUrl;
      const b64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
      setOutputUrl(dataUrl);
      setStatus("done");
      // Merge output into node data so the debounced save persists it
      updateNodeData(id, { outputB64: b64, outputImageUrl: dataUrl, status: "done", prompt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [id, sessionId, prompt, isBaseConnected, updateNodeData, data]);

  const download = useCallback(() => {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `staged_${id}.jpg`;
    a.click();
  }, [outputUrl, id]);

  const buttonLabel =
    status === "error" ? "Retry"
    : status === "done" ? "Re-generate"
    : "Generate";

  return (
    <div className={`bg-white border-2 ${selected ? "border-sage-500 ring-2 ring-sage-200" : "border-sage-200"} rounded-[var(--radius-node)] shadow-sm w-64 overflow-hidden transition-[border-color,box-shadow]`}>
      <div className="px-3 py-2 bg-sage-50 border-b border-sage-200 flex items-center justify-between">
        <StatusDot status={status} />
        <div className="flex items-center gap-1.5">
          {status === "done" && (
            <button
              onClick={download}
              className="text-stone-400 hover:text-sage-600 transition-colors nodrag"
              title="Download staged image"
            >
              <Download size={13} />
            </button>
          )}
          <button
            onClick={handleDelete}
            className="text-stone-300 hover:text-clay-400 transition-colors nodrag"
            title="Delete node"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="base"
        style={HANDLE_BASE_STYLE}
        className="!w-4 !h-4 !bg-stone-400 !border-2 !border-white"
        title="Base photo"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="ref"
        style={HANDLE_REF_STYLE}
        className="!w-4 !h-4 !bg-acacia-400 !border-2 !border-white"
        title="Reference (style)"
      />

      <div className="p-3 space-y-2">
        {!isBaseConnected && (
          <div className="flex items-center gap-1.5 text-[10px] text-stone-400 py-0.5">
            <ImageIcon size={11} />
            Connect a photo node to generate
          </div>
        )}
        <Textarea
          value={prompt}
          onChange={e => {
            setPrompt(e.target.value);
            updateNodeData(id, { prompt: e.target.value });
          }}
          placeholder="Describe the staging…"
          className="text-xs resize-none h-20 nodrag"
          onMouseDown={e => e.stopPropagation()}
        />
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
        title="Staged output"
      />
    </div>
  );
});
