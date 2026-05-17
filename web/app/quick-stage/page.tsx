"use client";

import { useState, useRef, useCallback, DragEvent, ChangeEvent } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SignInModal } from "@/components/SignInModal";
import { GENERATION_MODELS, DEFAULT_MODEL_ID, type ModelId } from "@/lib/models";
import { Loader2, X, Download, ImagePlus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ReferenceMode = "same" | "different";

// Layout constants — everything anchors to these
const CARD_W = 260;
const CARD_H = 195; // 4:3
const GAP = 40;
const TOTAL_W = CARD_W * 2 + GAP; // 560
const OUT_W = 360;
const OUT_H = 270;

// ─── Image Drop Zone ──────────────────────────────────────────────────────────

interface DropZoneProps {
  label: string;
  sublabel: string;
  image: string | null;
  onImage: (dataUrl: string) => void;
  onClear: () => void;
}

function ImageDropZone({ label, sublabel, image, onImage, onClear }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Please upload an image file");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === "string") onImage(result);
      };
      reader.readAsDataURL(file);
    },
    [onImage]
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) readFile(file);
    },
    [readFile]
  );

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium text-stone-700">{label}</p>
        <p className="text-xs text-stone-400">{sublabel}</p>
      </div>
      <div
        style={{ width: CARD_W, height: CARD_H }}
        className={cn(
          "relative rounded-xl border-2 overflow-hidden transition-colors",
          image
            ? "border-stone-200"
            : isDragOver
            ? "border-sage-400 bg-sage-50 cursor-copy"
            : "border-dashed border-stone-300 bg-stone-50 hover:border-sage-300 hover:bg-sage-50/40 cursor-pointer"
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => { if (!image) inputRef.current?.click(); }}
      >
        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={label} className="w-full h-full object-cover" />
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
            >
              <X size={12} className="text-white" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2.5 px-4 text-center select-none">
            <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center">
              <ImagePlus size={18} className={isDragOver ? "text-sage-500" : "text-stone-400"} />
            </div>
            <p className="text-xs text-stone-400 leading-snug">
              {isDragOver ? "Drop to upload" : "Drop image here or click to upload"}
            </p>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
      />
    </div>
  );
}

// ─── Converging Arrows SVG ────────────────────────────────────────────────────

function ConvergingArrows() {
  const leftX = CARD_W / 2;
  const rightX = CARD_W + GAP + CARD_W / 2;
  const midX = TOTAL_W / 2;

  return (
    <svg
      width={TOTAL_W}
      height={56}
      viewBox={`0 0 ${TOTAL_W} 56`}
      className="shrink-0"
      fill="none"
    >
      <defs>
        <marker
          id="qs-arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="#d6d3d0" />
        </marker>
      </defs>
      <line
        x1={leftX} y1={3}
        x2={midX - 4} y2={50}
        stroke="#d6d3d0"
        strokeWidth="1.5"
        markerEnd="url(#qs-arrowhead)"
      />
      <line
        x1={rightX} y1={3}
        x2={midX + 4} y2={50}
        stroke="#d6d3d0"
        strokeWidth="1.5"
        markerEnd="url(#qs-arrowhead)"
      />
    </svg>
  );
}

// ─── Output Zone ─────────────────────────────────────────────────────────────

interface OutputZoneProps {
  image: string | null;
  isGenerating: boolean;
}

function OutputZone({ image, isGenerating }: OutputZoneProps) {
  const handleDownload = () => {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image;
    a.download = `quick-stage-${Date.now()}.jpg`;
    a.click();
  };

  return (
    <div
      style={{ width: OUT_W, height: OUT_H }}
      className={cn(
        "relative rounded-xl border-2 overflow-hidden transition-colors",
        image ? "border-stone-200" : "border-dashed border-stone-200 bg-stone-50"
      )}
    >
      {isGenerating ? (
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <Loader2 size={24} className="text-sage-500 animate-spin" />
          <p className="text-sm text-stone-500">Furnishing room…</p>
        </div>
      ) : image ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Generated staging" className="w-full h-full object-cover" />
          <button
            onClick={handleDownload}
            className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 hover:bg-black/70 text-white text-xs font-medium transition-colors"
          >
            <Download size={12} />
            Download
          </button>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2.5 px-6 text-center select-none">
          <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
            <Sparkles size={20} className="text-stone-300" />
          </div>
          <p className="text-xs text-stone-400">Your furnished room will appear here</p>
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

interface SettingsPanelProps {
  model: ModelId;
  onModelChange: (m: ModelId) => void;
  referenceMode: ReferenceMode;
  onReferenceModeChange: (m: ReferenceMode) => void;
  hasReference: boolean;
  prompt: string;
  onPromptChange: (v: string) => void;
  onGenerate: () => void;
  canGenerate: boolean;
  isGenerating: boolean;
}

function SettingsPanel({
  model,
  onModelChange,
  referenceMode,
  onReferenceModeChange,
  hasReference,
  prompt,
  onPromptChange,
  onGenerate,
  canGenerate,
  isGenerating,
}: SettingsPanelProps) {
  return (
    <div className="w-72 border-l border-stone-200 bg-white flex flex-col shrink-0 overflow-y-auto">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-stone-200 bg-stone-50 shrink-0">
        <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">
          Quick Stage Settings
        </p>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">

        {/* Reference mode toggle */}
        <div className={cn("space-y-2", !hasReference && "opacity-40 pointer-events-none")}>
          <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">
            Reference Image Is
          </p>
          <div className="flex rounded-lg border border-stone-200 overflow-hidden text-xs">
            <button
              onClick={() => onReferenceModeChange("same")}
              className={cn(
                "flex-1 py-2 px-3 transition-colors text-xs font-medium",
                referenceMode === "same"
                  ? "bg-sage-50 text-sage-700"
                  : "bg-white text-stone-500 hover:bg-stone-50"
              )}
            >
              Same Room
            </button>
            <button
              onClick={() => onReferenceModeChange("different")}
              className={cn(
                "flex-1 py-2 px-3 border-l border-stone-200 transition-colors text-xs font-medium",
                referenceMode === "different"
                  ? "bg-sage-50 text-sage-700"
                  : "bg-white text-stone-500 hover:bg-stone-50"
              )}
            >
              Different Room
            </button>
          </div>
          <p className="text-[11px] text-stone-400 leading-snug">
            {hasReference
              ? referenceMode === "same"
                ? "Matches furniture precisely; accounts for objects that may shift out of frame with the angle change."
                : "Treats the reference as style inspiration; adapts placement and scale to fit this room's layout."
              : "Add a reference image above to enable this setting."}
          </p>
        </div>

        {/* Model selector */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">
            Generation Model
          </p>
          <div className="space-y-1.5">
            {GENERATION_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => onModelChange(m.id as ModelId)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-lg border transition-colors",
                  model === m.id
                    ? "border-sage-300 bg-sage-50 text-sage-800"
                    : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs font-medium">{m.label}</span>
                  <span className="text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full shrink-0">
                    {m.provider}
                  </span>
                </div>
                <p className="text-[11px] text-stone-400">{m.note}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Additional instructions + generate button */}
        <div className="space-y-2">
          <Label htmlFor="qs-prompt" className="text-[11px] font-medium text-stone-400 uppercase tracking-wide">
            Additional Instructions
          </Label>
          <Textarea
            id="qs-prompt"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="e.g. Warm tones, add a rug, Scandinavian style…"
            className="resize-none h-24 text-sm"
          />
        </div>

        <Button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="w-full"
        >
          {isGenerating ? (
            <>
              <Loader2 size={15} className="animate-spin mr-2" />
              Furnishing…
            </>
          ) : (
            "Furnish This Room"
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickStagePage() {
  const { data: session } = useSession();
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [outputImage, setOutputImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("different");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  const handleGenerate = async () => {
    if (!baseImage) return;
    if (!session?.user) {
      setShowSignIn(true);
      return;
    }
    setIsGenerating(true);
    setOutputImage(null);
    try {
      const res = await fetch("/api/quick-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseImage,
          ...(refImage ? { referenceImage: refImage, referenceMode } : {}),
          prompt,
          model,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setOutputImage(data.imageDataUrl);
      toast.success("Room furnished!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = !!baseImage && !isGenerating;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Scrollable main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-8 py-12">
          {/* Input images row */}
          <div className="flex items-start" style={{ gap: GAP }}>
            <ImageDropZone
              label="Unfurnished Room"
              sublabel="The room to furnish"
              image={baseImage}
              onImage={setBaseImage}
              onClear={() => { setBaseImage(null); setOutputImage(null); }}
            />
            <ImageDropZone
              label="Reference: Furnished Room"
              sublabel="Style to match (optional)"
              image={refImage}
              onImage={setRefImage}
              onClear={() => { setRefImage(null); setOutputImage(null); }}
            />
          </div>

          {/* Converging arrows */}
          <ConvergingArrows />

          {/* Output zone */}
          <OutputZone image={outputImage} isGenerating={isGenerating} />
        </div>
      </div>

      {/* Right settings panel */}
      <SettingsPanel
        model={model}
        onModelChange={setModel}
        referenceMode={referenceMode}
        onReferenceModeChange={setReferenceMode}
        hasReference={!!refImage}
        prompt={prompt}
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        canGenerate={canGenerate}
        isGenerating={isGenerating}
      />

      <SignInModal
        open={showSignIn}
        onOpenChange={setShowSignIn}
        message="Sign in to generate your first staged room."
      />
    </div>
  );
}
