"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { useNodes, useReactFlow, Panel } from "@xyflow/react";
import {
  X,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { GENERATION_MODELS, DEFAULT_MODEL_ID } from "@/lib/models";
import { SessionContext } from "./SessionContext";
import type { GenerationNodeData, PhotoNodeData } from "@/types/nodes";

interface HistoryEntry {
  id: string;
  outputUrl?: string;
  outputB64?: string;
  createdAt: string;
}

export function NodeInspectorPanel({
  selectedNodeId,
  onClose,
}: {
  selectedNodeId: string;
  onClose: () => void;
}) {
  const nodes = useNodes();
  const { updateNodeData, deleteElements } = useReactFlow();
  const { readOnly } = useContext(SessionContext);

  const node = nodes.find((n) => n.id === selectedNodeId);
  const genData = node?.type === "generation"
    ? (node.data as unknown as GenerationNodeData)
    : null;
  const photoData = node?.type === "photo"
    ? (node.data as unknown as PhotoNodeData)
    : null;

  // State resets automatically via key={selectedNodeId} in the parent
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyStep, setHistoryStep] = useState(0);
  const [localPrompt, setLocalPrompt] = useState(genData?.prompt ?? "");

  // Fetch history whenever this node's current output changes (setState only in async callbacks)
  const outputB64 = genData?.outputB64;
  useEffect(() => {
    if (!outputB64) return;
    fetch(`/api/history/${selectedNodeId}`)
      .then((r) => r.json())
      .then((d) => {
        setHistory(d.history ?? []);
        setHistoryStep(0);
      })
      .catch(() => setHistory([]));
  }, [selectedNodeId, outputB64]);

  function historyEntryImageUrl(entry: HistoryEntry): string | undefined {
    if (entry.outputUrl) return entry.outputUrl;
    if (entry.outputB64) return `data:image/jpeg;base64,${entry.outputB64}`;
    return undefined;
  }

  const displayImageUrl =
    historyStep === 0
      ? genData?.outputImageUrl
      : history[historyStep - 1]
      ? historyEntryImageUrl(history[historyStep - 1])
      : genData?.outputImageUrl;

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id: selectedNodeId }] });
    onClose();
  }, [deleteElements, selectedNodeId, onClose]);

  const handleDownload = useCallback(() => {
    if (!displayImageUrl) return;
    const a = document.createElement("a");
    a.href = displayImageUrl;
    const suffix = historyStep > 0 ? `_v${history.length - historyStep + 1}` : "";
    a.download = `staged_${selectedNodeId}${suffix}.jpg`;
    a.click();
  }, [displayImageUrl, selectedNodeId, historyStep, history.length]);

  const handleRestore = useCallback(async () => {
    const entry = history[historyStep - 1];
    if (!entry) return;
    const restoredImageUrl = historyEntryImageUrl(entry);
    if (entry.outputUrl) {
      updateNodeData(selectedNodeId, { outputUrl: entry.outputUrl, outputImageUrl: entry.outputUrl, status: "done" });
    } else if (entry.outputB64) {
      updateNodeData(selectedNodeId, { outputB64: entry.outputB64, outputImageUrl: restoredImageUrl, status: "done" });
    }
    await fetch(`/api/history/${selectedNodeId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ historyId: entry.id }),
    });
    setHistoryStep(0);
  }, [history, historyStep, selectedNodeId, updateNodeData]);

  if (!node) return null;

  const currentModel = genData?.model ?? DEFAULT_MODEL_ID;

  return (
    <Panel
      position="top-right"
      style={{ top: 0, right: 0, bottom: 0, margin: 0 }}
    >
      <div className="h-full w-[300px] bg-white border-l border-stone-200 flex flex-col overflow-hidden nowheel nopan nodrag">
        {/* Header */}
        <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between shrink-0">
          <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wide">
            {node.type === "generation" ? "Generation Node" : "Photo Node"}
          </span>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 transition-colors"
            title="Close panel"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Photo node */}
          {photoData && (
            <div className="p-4 space-y-3">
              <p
                className="text-xs text-stone-500 truncate"
                title={photoData.filename}
              >
                {photoData.filename}
              </p>
              {photoData.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoData.photoUrl}
                  alt={photoData.filename}
                  className="w-full rounded-lg object-cover"
                />
              )}
            </div>
          )}

          {/* Generation node */}
          {genData && (
            <div className="divide-y divide-stone-100">
              {/* Prompt */}
              <div className="p-4 space-y-2">
                <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
                  Prompt
                </p>
                <Textarea
                  value={localPrompt}
                  onChange={readOnly ? undefined : (e) => {
                    setLocalPrompt(e.target.value);
                    updateNodeData(selectedNodeId, { prompt: e.target.value });
                  }}
                  readOnly={readOnly}
                  placeholder={readOnly ? "" : "Describe the staging…"}
                  className={`text-xs resize-none h-24 ${readOnly ? "cursor-default bg-stone-50 text-stone-500" : ""}`}
                />
              </div>

              {/* Model — hidden in readOnly */}
              {!readOnly && (
                <div className="p-4 space-y-2">
                  <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
                    Model
                  </p>
                  <div className="space-y-1">
                    {GENERATION_MODELS.map((m) => {
                      const active = currentModel === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() =>
                            updateNodeData(selectedNodeId, { model: m.id })
                          }
                          className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                            active
                              ? "border-sage-300 bg-sage-50"
                              : "border-transparent hover:border-stone-200 hover:bg-stone-50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-xs font-medium ${
                                active ? "text-sage-800" : "text-stone-700"
                              }`}
                            >
                              {m.label}
                            </span>
                            <span className="text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded shrink-0">
                              {m.provider}
                            </span>
                          </div>
                          <p className="text-[10px] text-stone-400 mt-0.5">
                            {m.note}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Output */}
              {(displayImageUrl || genData.status === "done") && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-medium text-stone-400 uppercase tracking-wide">
                      Output
                    </p>
                    {history.length > 0 && (
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() =>
                            setHistoryStep((s) =>
                              Math.min(s + 1, history.length)
                            )
                          }
                          disabled={historyStep >= history.length}
                          className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 transition-colors"
                          title="Older generation"
                        >
                          <ChevronLeft size={13} />
                        </button>
                        <span className="text-[10px] text-stone-400 min-w-[44px] text-center">
                          {historyStep === 0 ? "Current" : `−${historyStep}`}
                        </span>
                        <button
                          onClick={() =>
                            setHistoryStep((s) => Math.max(s - 1, 0))
                          }
                          disabled={historyStep === 0}
                          className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 transition-colors"
                          title="Newer generation"
                        >
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  {displayImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={displayImageUrl}
                      alt="staged output"
                      className="w-full rounded-lg object-cover"
                    />
                  )}

                  {!readOnly && historyStep > 0 && (
                    <Button
                      size="sm"
                      onClick={handleRestore}
                      variant="outline"
                      className="w-full text-xs border-stone-200 hover:border-sage-300 hover:bg-sage-50 hover:text-sage-700"
                    >
                      <RotateCcw size={12} className="mr-1.5" />
                      Restore this version
                    </Button>
                  )}

                  {displayImageUrl && (
                    <button
                      onClick={handleDownload}
                      className="w-full flex items-center justify-center gap-2 text-xs text-stone-500 hover:text-stone-700 border border-stone-200 hover:border-stone-300 rounded-lg py-2 transition-colors"
                    >
                      <Download size={13} />
                      Download image
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — delete (hidden in readOnly) */}
        {!readOnly && (
          <div className="px-4 py-3 border-t border-stone-200 shrink-0">
            <button
              onClick={handleDelete}
              className="w-full flex items-center justify-center gap-2 text-xs text-stone-400 hover:text-clay-500 hover:bg-clay-50 rounded-lg py-2 transition-colors"
            >
              <Trash2 size={13} />
              Delete node
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
