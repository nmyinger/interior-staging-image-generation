"use client";

import { memo, useCallback, useContext, useState } from "react";
import { signIn } from "next-auth/react";
import { Handle, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { Loader2, Sparkles, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CanvasContext } from "./CanvasContext";
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
  const { sessionId, readOnly, isDemo } = useContext(CanvasContext);
  const { updateNodeData } = useReactFlow();
  const [showSignInDialog, setShowSignInDialog] = useState(false);

  // Reactive: re-renders when any edge connecting this node's base handle changes
  const isBaseConnected = useStore(s =>
    s.edges.some(e => e.target === id && e.targetHandle === "base")
  );

  const [status, setStatus] = useState<NodeStatus>(d.status ?? "idle");
  const [outputUrl, setOutputUrl] = useState(d.outputImageUrl ?? "");
  const [error, setError] = useState(d.error ?? "");

  const generate = useCallback(async () => {
    if (!isBaseConnected) return;
    if (isDemo) { setShowSignInDialog(true); return; }
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
  }, [id, sessionId, isBaseConnected, isDemo, updateNodeData, data]);

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
        {(!readOnly || isDemo) && (
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

        <Dialog open={showSignInDialog} onOpenChange={setShowSignInDialog}>
          <DialogContent className="sm:max-w-[360px]">
            <DialogHeader>
              <DialogTitle>Sign in to generate</DialogTitle>
              <DialogDescription>
                Create a free account to start staging photos. You get 3 free generations.
              </DialogDescription>
            </DialogHeader>
            <Button
              className="w-full gap-3 bg-sage-600 hover:bg-sage-700 text-white mt-2"
              onClick={() => signIn("google", { callbackUrl: "/properties" })}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {outputUrl && (
        <div className="border-t border-sage-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              outputUrl.includes("/api/assets/") || !outputUrl.startsWith("http")
                ? outputUrl
                : `/api/blob-proxy?url=${encodeURIComponent(outputUrl)}&w=600`
            }
            alt="staged"
            loading="lazy"
            className="w-full max-h-48 object-cover block"
          />
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
