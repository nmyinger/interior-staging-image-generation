"use client";

import { useCallback, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { Loader2, Sparkles, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { GenerationNodeData } from "@/types/nodes";

export function GenerationNode({ id, data }: NodeProps) {
  const d = data as unknown as GenerationNodeData;
  const { getEdges, getNode } = useReactFlow();
  const [prompt, setPrompt] = useState(d.prompt);
  const [status, setStatus] = useState(d.status);
  const [outputUrl, setOutputUrl] = useState(d.outputImageUrl ?? "");
  const [error, setError] = useState(d.error ?? "");

  const generate = useCallback(async () => {
    setStatus("generating");
    setError("");

    // Find connected reference image (from another generation node's output)
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
        body: JSON.stringify({
          baseFilename: d.filename,
          referenceDataUrl,
          prompt,
        }),
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

  return (
    <div className="bg-white border-2 border-violet-200 rounded-xl shadow-sm w-72 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-violet-50 border-b border-violet-200 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-violet-800 truncate">{d.filename}</p>
          <Badge variant="outline" className="mt-1 text-[10px] border-violet-300 text-violet-600">
            {d.roomType.replace("_", " ")}
          </Badge>
        </div>
        {status === "done" && (
          <button onClick={download} className="text-violet-400 hover:text-violet-600 ml-2">
            <Download size={14} />
          </button>
        )}
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
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to stage in this photo..."
          className="text-xs resize-none h-24 nodrag"
          onMouseDown={(e) => e.stopPropagation()}
        />
        <Button
          size="sm"
          className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          onClick={generate}
          disabled={status === "generating"}
        >
          {status === "generating" ? (
            <><Loader2 size={12} className="mr-1 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles size={12} className="mr-1" /> Generate</>
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
