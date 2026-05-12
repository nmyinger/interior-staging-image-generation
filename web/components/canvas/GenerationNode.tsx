"use client";

import { useCallback, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { Loader2, Sparkles, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { GenerationNodeData, NodeStatus } from "@/types/nodes";

function StatusDot({ status }: { status: NodeStatus }) {
  const cls =
    status === "done" ? "bg-emerald-500"
    : status === "generating" ? "bg-amber-400 animate-pulse"
    : status === "error" ? "bg-red-400"
    : "bg-slate-300";
  return <div className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

export function GenerationNode({ id, data }: NodeProps) {
  const d = data as unknown as GenerationNodeData;
  const { getEdges, getNode, deleteElements, updateNodeData } = useReactFlow();
  const [prompt, setPrompt] = useState(d.prompt);
  const [status, setStatus] = useState(d.status);
  const [outputUrl, setOutputUrl] = useState(d.outputImageUrl ?? "");
  const [error, setError] = useState(d.error ?? "");

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [id, deleteElements]);

  const generate = useCallback(async () => {
    setStatus("generating");
    setError("");

    const edges = getEdges();
    const refEdge = edges.find((e) => e.target === id && e.targetHandle === "ref");
    let referenceDataUrl: string | undefined;
    if (refEdge) {
      const refNode = getNode(refEdge.source);
      const refData = refNode?.data as unknown as GenerationNodeData | undefined;
      referenceDataUrl = refData?.outputImageUrl;
    }

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseFilename: d.filename, referenceDataUrl, prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Generation failed");
      setOutputUrl(json.imageDataUrl);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [id, d.filename, prompt, getEdges, getNode]);

  const download = useCallback(() => {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `${d.filename.replace(/\.[^.]+$/, "")}_staged.jpg`;
    a.click();
  }, [outputUrl, d.filename]);

  const buttonLabel =
    status === "error" ? "Retry"
    : status === "done" ? "Re-generate"
    : "Generate";

  return (
    <div className="bg-white border-2 border-violet-200 rounded-xl shadow-sm w-72 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-violet-50 border-b border-violet-200 flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-2">
          <StatusDot status={status} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-violet-800 truncate">{d.filename}</p>
            <Badge variant="outline" className="mt-1 text-[10px] border-violet-300 text-violet-600">
              {d.roomType.replace("_", " ")}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {status === "done" && (
            <button
              onClick={download}
              className="text-violet-400 hover:text-violet-600 nodrag"
              title="Download staged image"
            >
              <Download size={14} />
            </button>
          )}
          <button
            onClick={handleDelete}
            className="text-slate-300 hover:text-red-400 transition-colors nodrag"
            title="Delete node"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="base"
        style={{ top: "30%" }}
        className="!w-3 !h-3 !bg-slate-400"
        title="Base photo"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="ref"
        style={{ top: "60%" }}
        className="!w-3 !h-3 !bg-amber-400"
        title="Reference (style)"
      />

      {/* Prompt */}
      <div className="p-3 space-y-2">
        <Textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            updateNodeData(id, { ...d, prompt: e.target.value });
          }}
          placeholder="Describe what to stage in this photo..."
          className="text-xs resize-none h-24 nodrag"
          onMouseDown={(e) => e.stopPropagation()}
        />
        <Button
          size="sm"
          className={`w-full text-white ${status === "error" ? "bg-red-500 hover:bg-red-600" : "bg-violet-600 hover:bg-violet-700"}`}
          onClick={generate}
          disabled={status === "generating"}
        >
          {status === "generating" ? (
            <><Loader2 size={12} className="mr-1 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles size={12} className="mr-1" /> {buttonLabel}</>
          )}
        </Button>
        {status === "error" && (
          <p className="text-[10px] text-red-500">{error}</p>
        )}
      </div>

      {/* Output image */}
      {outputUrl && (
        <div className="border-t border-violet-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={outputUrl} alt="staged" className="w-full object-cover" />
        </div>
      )}

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3 !h-3 !bg-violet-500"
        title="Staged output"
      />
    </div>
  );
}
