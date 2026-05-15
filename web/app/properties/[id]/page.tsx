"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/properties/StatusBadge";
import type { PropertyStatus } from "@/components/properties/StatusBadge";
import { PhotoUploadGrid } from "@/components/properties/PhotoUploadGrid";
import type { PropertyPhoto } from "@/components/properties/PhotoUploadGrid";
import { BatchProgress } from "@/components/properties/BatchProgress";
import type { BatchItem } from "@/components/properties/BatchProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Loader2,
  Zap,
  Check,
  Download,
  PencilLine,
  Frame,
  Plus,
} from "lucide-react";

const MLS_OPTIONS = [
  { value: "", label: "None" },
  { value: "HAR", label: "HAR" },
  { value: "ACTRIS", label: "ACTRIS" },
  { value: "CRMLS", label: "CRMLS" },
  { value: "SDMLS", label: "SDMLS" },
  { value: "BRIGHT", label: "Bright MLS" },
  { value: "FMLS", label: "FMLS" },
  { value: "BEACHES", label: "BeachesMLS" },
  { value: "CA-AB723", label: "CA-AB723" },
  { value: "WI-ACT69", label: "WI-Act69" },
];

const STYLE_OPTIONS = [
  { value: "", label: "Select a style…" },
  { value: "modern-transitional", label: "Modern Transitional" },
  { value: "modern-farmhouse", label: "Modern Farmhouse" },
  { value: "scandinavian", label: "Scandinavian" },
  { value: "mid-century-modern", label: "Mid-Century Modern" },
  { value: "traditional", label: "Traditional" },
  { value: "coastal", label: "Coastal" },
  { value: "industrial", label: "Industrial" },
];

interface PropertyData {
  id: string;
  name: string;
  address: string | null;
  mls: string | null;
  status: PropertyStatus;
  style_brief: {
    style?: string;
    colorNotes?: string;
    additionalNotes?: string;
  };
  created_at: string;
  photos: PropertyPhoto[];
  latest_batch: {
    id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
  } | null;
}

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const propertyId = params.id as string;

  const [property, setProperty] = useState<PropertyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Style brief
  const [style, setStyle] = useState("");
  const [colorNotes, setColorNotes] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefSaved, setBriefSaved] = useState(false);

  // Batch controls
  const [staging, setStaging] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [completedItems, setCompletedItems] = useState<BatchItem[] | null>(null);

  // Photos state
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);

  // Canvases state
  const [canvases, setCanvases] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [creatingCanvas, setCreatingCanvas] = useState(false);

  const initialized = useRef(false);

  const loadCanvases = useCallback(async () => {
    const res = await fetch(`/api/sessions?property_id=${propertyId}`);
    if (res.ok) {
      const data = await res.json();
      setCanvases(data.sessions ?? []);
    }
  }, [propertyId]);

  const createCanvas = useCallback(async () => {
    setCreatingCanvas(true);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: propertyId }),
    });
    if (res.ok) {
      const { id } = await res.json();
      router.push(`/canvas/${id}`);
    } else {
      setCreatingCanvas(false);
    }
  }, [propertyId, router]);

  const loadProperty = useCallback(async () => {
    try {
      const res = await fetch(`/api/properties/${propertyId}`);
      if (res.status === 401) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setLoadError("Property not found.");
        setLoading(false);
        return;
      }
      const data: PropertyData = await res.json();
      setProperty(data);
      setPhotos(data.photos ?? []);
      setStyle(data.style_brief?.style ?? "");
      setColorNotes(data.style_brief?.colorNotes ?? "");
      setAdditionalNotes(data.style_brief?.additionalNotes ?? "");

      // Resume polling if there's an active batch
      const lb = data.latest_batch;
      if (lb && lb.status !== "done" && lb.status !== "failed") {
        setActiveBatchId(lb.id);
      }
    } catch {
      setLoadError("Failed to load property.");
    } finally {
      setLoading(false);
    }
  }, [propertyId, router]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadProperty();
      loadCanvases();
    }
  }, [loadProperty, loadCanvases]);

  // Name editing
  function startEditName() {
    setNameDraft(property?.name ?? "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }

  async function commitName() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === property?.name) return;
    setProperty((p) => (p ? { ...p, name: trimmed } : p));
    await fetch(`/api/properties/${propertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
  }

  // Style brief save
  const saveBrief = useCallback(async () => {
    setBriefSaving(true);
    await fetch(`/api/properties/${propertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        style_brief: {
          style: style || undefined,
          colorNotes: colorNotes.trim() || undefined,
          additionalNotes: additionalNotes.trim() || undefined,
        },
      }),
    });
    setBriefSaving(false);
    setBriefSaved(true);
    setTimeout(() => setBriefSaved(false), 2000);
  }, [propertyId, style, colorNotes, additionalNotes]);

  // Stage all photos
  async function stageAllPhotos() {
    if (photos.length === 0) return;
    setStaging(true);
    setStageError(null);
    setCompletedItems(null);

    try {
      const res = await fetch(`/api/properties/${propertyId}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStageError(err.error ?? "Failed to start batch.");
        return;
      }
      const data = await res.json();
      const batchId = data.batchId ?? data.id;
      setActiveBatchId(batchId);
      setProperty((p) => (p ? { ...p, status: "queued" } : p));
    } catch {
      setStageError("Network error. Please try again.");
    } finally {
      setStaging(false);
    }
  }

  function handleBatchComplete(items: BatchItem[]) {
    setCompletedItems(items);
    setProperty((p) => (p ? { ...p, status: "done" } : p));
    // Merge staged URLs into photos
    setPhotos((prev) =>
      prev.map((photo) => {
        const matchedItem = items.find(
          (item) => item.photo_filename === photo.photo_filename
        );
        if (matchedItem?.staged_url) {
          return { ...photo, stagedUrl: matchedItem.staged_url, batchStatus: "done" };
        }
        return photo;
      })
    );
  }

  const batchIsActive =
    activeBatchId !== null &&
    property?.status !== "done" &&
    property?.status !== "failed";

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-stone-300" />
      </div>
    );
  }

  if (loadError || !property) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-stone-500">{loadError ?? "Property not found."}</p>
        <Link href="/properties" className="text-sm text-sage-600 hover:underline">
          Back to properties
        </Link>
      </div>
    );
  }

  return (
    <div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Back link */}
        <Link
          href="/properties"
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 mb-5 transition-colors w-fit"
        >
          <ArrowLeft size={13} />
          Properties
        </Link>

        {/* Property header */}
        <div className="mb-6 flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {editingName ? (
                <input
                  ref={nameInputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="text-xl font-semibold text-stone-900 bg-transparent border-b-2 border-sage-400 outline-none"
                  autoFocus
                />
              ) : (
                <button
                  onClick={startEditName}
                  className="group flex items-center gap-2"
                  title="Click to rename"
                >
                  <h1 className="text-xl font-semibold text-stone-900">{property.name}</h1>
                  <PencilLine
                    size={14}
                    className="text-stone-300 group-hover:text-stone-500 transition-colors"
                  />
                </button>
              )}
              <StatusBadge status={property.status} />
              {property.mls && (
                <span className="inline-flex items-center text-[11px] text-acacia-500 bg-acacia-100 border border-acacia-200 rounded-full px-2 py-0.5 font-medium">
                  {property.mls}
                </span>
              )}
            </div>
            {property.address && (
              <p className="text-xs text-stone-400 mt-1">{property.address}</p>
            )}
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
          {/* Left: Photo grid */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-700">Photos</h2>
            </div>
            <PhotoUploadGrid
              propertyId={propertyId}
              photos={photos}
              onPhotosChange={setPhotos}
            />
          </div>

          {/* Right: Style brief + batch controls */}
          <div className="space-y-4">
            {/* Style brief */}
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-stone-100">
                <h2 className="text-sm font-semibold text-stone-700">Style brief</h2>
              </div>
              <div className="p-4 space-y-4">
                {/* Style */}
                <div className="space-y-1.5">
                  <Label>Design style</Label>
                  <Select value={style} onValueChange={(val) => setStyle(val ?? "")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Color palette notes */}
                <div className="space-y-1.5">
                  <Label>Color palette</Label>
                  <Textarea
                    value={colorNotes}
                    onChange={(e) => setColorNotes(e.target.value)}
                    placeholder="Warm whites, greige tones, natural wood…"
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>

                {/* Additional notes */}
                <div className="space-y-1.5">
                  <Label>Additional notes</Label>
                  <Textarea
                    value={additionalNotes}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                    placeholder="Furniture preferences, layout constraints…"
                    rows={3}
                    className="resize-none text-sm"
                  />
                </div>

                {/* MLS selector */}
                <div className="space-y-1.5">
                  <Label>MLS board</Label>
                  <Select
                    value={property.mls ?? ""}
                    onValueChange={async (val) => {
                      const mls = val || null;
                      setProperty((p) => (p ? { ...p, mls } : p));
                      await fetch(`/api/properties/${propertyId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mls }),
                      });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MLS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.value ? opt.label : "None"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Save button */}
                <Button
                  onClick={saveBrief}
                  disabled={briefSaving}
                  size="sm"
                  className="w-full bg-sage-600 hover:bg-sage-700 text-white flex items-center justify-center gap-2"
                >
                  {briefSaving ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : briefSaved ? (
                    <Check size={13} />
                  ) : null}
                  {briefSaved ? "Saved" : "Save brief"}
                </Button>
              </div>
            </div>

            {/* Batch controls */}
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-stone-100">
                <h2 className="text-sm font-semibold text-stone-700">Batch staging</h2>
              </div>
              <div className="p-4 space-y-4">
                {/* Stage all button */}
                {!batchIsActive && (
                  <>
                    <Button
                      onClick={stageAllPhotos}
                      disabled={staging || photos.length === 0}
                      className="w-full bg-sage-600 hover:bg-sage-700 text-white flex items-center justify-center gap-2"
                    >
                      {staging ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Zap size={14} />
                      )}
                      {staging ? "Starting…" : `Stage all ${photos.length} photo${photos.length !== 1 ? "s" : ""}`}
                    </Button>

                    {photos.length === 0 && (
                      <p className="text-xs text-stone-400 text-center">
                        Upload photos first to start staging
                      </p>
                    )}

                    {stageError && (
                      <p className="text-xs text-clay-500 bg-clay-400/5 border border-clay-400/20 rounded-lg px-3 py-2">
                        {stageError}
                      </p>
                    )}
                  </>
                )}

                {/* Progress panel — while running */}
                {batchIsActive && activeBatchId && (
                  <BatchProgress
                    batchId={activeBatchId}
                    totalPhotos={photos.length}
                    onComplete={handleBatchComplete}
                  />
                )}

                {/* Results — when done */}
                {completedItems && completedItems.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-stone-600">
                        {completedItems.filter((i) => i.staged_url).length} staged results
                      </p>
                      {/* Re-run batch button */}
                      <button
                        onClick={stageAllPhotos}
                        disabled={staging}
                        className="text-xs text-sage-600 hover:text-sage-800 flex items-center gap-1"
                      >
                        <Zap size={11} />
                        Re-run
                      </button>
                    </div>

                    {/* Download all — open each individually in new tab */}
                    {completedItems.some((i) => i.staged_url) && (
                      <button
                        onClick={() => {
                          completedItems
                            .filter((i) => i.staged_url)
                            .forEach((item) => {
                              window.open(item.staged_url!, "_blank");
                            });
                        }}
                        className="w-full flex items-center justify-center gap-2 text-xs text-stone-600 hover:text-stone-800 border border-stone-200 hover:border-stone-300 rounded-lg py-2 transition-colors"
                      >
                        <Download size={13} />
                        Download all ({completedItems.filter((i) => i.staged_url).length})
                      </button>
                    )}
                  </div>
                )}

                {/* Previously completed batch (from initial load) */}
                {!batchIsActive &&
                  !completedItems &&
                  property.latest_batch &&
                  (property.latest_batch.status === "done" ||
                    property.latest_batch.status === "failed") && (
                    <div className="space-y-2">
                      <p className="text-xs text-stone-400">
                        Last batch:{" "}
                        <StatusBadge
                          status={
                            (property.latest_batch.status as PropertyStatus) ?? "draft"
                          }
                        />
                      </p>
                      {property.status !== "done" && (
                        <Button
                          onClick={stageAllPhotos}
                          disabled={staging || photos.length === 0}
                          size="sm"
                          className="w-full bg-sage-600 hover:bg-sage-700 text-white flex items-center justify-center gap-2"
                        >
                          <Zap size={13} />
                          Run new batch
                        </Button>
                      )}
                    </div>
                  )}
              </div>
            </div>
          </div>
        </div>

        {/* Canvases section */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700">Canvases</h2>
            <button
              onClick={createCanvas}
              disabled={creatingCanvas}
              className="flex items-center gap-1.5 text-xs font-medium text-sage-700 hover:text-sage-900 bg-sage-50 hover:bg-sage-100 border border-sage-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              {creatingCanvas ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              New canvas
            </button>
          </div>

          {canvases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 bg-white rounded-2xl border border-stone-200">
              <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center">
                <Frame size={18} strokeWidth={1.25} className="text-stone-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-stone-600">No canvases yet</p>
                <p className="text-xs text-stone-400 mt-0.5">Create a canvas for interactive, photo-by-photo staging</p>
              </div>
              <button
                onClick={createCanvas}
                disabled={creatingCanvas}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-4 py-2 transition-colors shadow-sm"
              >
                {creatingCanvas ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                New canvas
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {canvases.map((canvas) => (
                <div
                  key={canvas.id}
                  className="bg-white rounded-xl border border-stone-200 hover:border-stone-300 hover:shadow-sm transition-all p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-sage-50 border border-sage-200 flex items-center justify-center shrink-0">
                      <Frame size={14} className="text-sage-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{canvas.name}</p>
                      <p className="text-[11px] text-stone-400">
                        {new Date(canvas.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/canvas/${canvas.id}`}
                    className="shrink-0 text-xs font-medium text-sage-700 bg-sage-50 hover:bg-sage-100 border border-sage-200 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
