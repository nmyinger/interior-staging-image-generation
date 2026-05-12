"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Database, Upload, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

import { SourceNode } from "./SourceNode";
import { GenerationNode } from "./GenerationNode";
import type { SourceNodeData, GenerationNodeData } from "@/types/nodes";

const nodeTypes: NodeTypes = {
  sourceNode: SourceNode,
  generationNode: GenerationNode,
};

interface PhotoRow {
  filename: string;
  room_type: string;
  zone: string;
  default_prompt: string;
}

interface GenerationRow {
  filename: string;
  prompt: string;
  output_b64: string | null;
  node_x: number;
  node_y: number;
}

interface EdgeRow {
  id: string;
  source_node: string;
  source_handle: string | null;
  target_node: string;
  target_handle: string | null;
}

const ZONE_COLORS: Record<string, string> = {
  open_plan: "#7c3aed",
  bedroom: "#0284c7",
  bathroom_suite: "#0891b2",
  unknown: "#64748b",
};

const COL_X = { source: 60, gen: 320 };
const ROW_H = 260;

type SaveState = "idle" | "saving" | "saved" | "error";

function buildNodesAndEdges(
  photos: PhotoRow[],
  generations: Record<string, GenerationRow>,
  dbEdges: EdgeRow[],
  srcPositions: Record<string, { x: number; y: number }>,
  hiddenSources: Set<string>
) {
  const nodes: Node[] = [];
  const autoEdges: Edge[] = [];
  let y = 40;

  const byZone: Record<string, PhotoRow[]> = {};
  for (const p of photos) {
    (byZone[p.zone] ??= []).push(p);
  }

  for (const [zone, group] of Object.entries(byZone)) {
    const color = ZONE_COLORS[zone] ?? ZONE_COLORS.unknown;

    for (const photo of group) {
      const srcId = `src-${photo.filename}`;
      const genId = `gen-${photo.filename}`;

      if (hiddenSources.has(srcId)) { y += ROW_H; continue; }

      const saved = generations[photo.filename];
      const genY = saved ? saved.node_y : y;
      const srcPos = srcPositions[srcId] ?? { x: COL_X.source, y: genY };

      const srcData: SourceNodeData = {
        filename: photo.filename,
        roomType: photo.room_type,
        label: photo.filename,
        photoUrl: `/api/photos/${encodeURIComponent(photo.filename)}`,
      };
      nodes.push({
        id: srcId,
        type: "sourceNode",
        position: srcPos,
        data: srcData as unknown as Record<string, unknown>,
        style: { borderColor: color },
      });

      const outputDataUrl = saved?.output_b64
        ? `data:image/jpeg;base64,${saved.output_b64}`
        : undefined;

      const genData: GenerationNodeData = {
        filename: photo.filename,
        roomType: photo.room_type,
        label: photo.filename,
        sourcePhotoUrl: `/api/photos/${encodeURIComponent(photo.filename)}`,
        prompt: saved?.prompt || photo.default_prompt,
        status: outputDataUrl ? "done" : "idle",
        outputImageUrl: outputDataUrl,
      };
      nodes.push({
        id: genId,
        type: "generationNode",
        position: { x: saved ? saved.node_x : COL_X.gen, y: genY },
        data: genData as unknown as Record<string, unknown>,
        style: { borderColor: color },
      });

      autoEdges.push({
        id: `auto-${srcId}-${genId}`,
        source: srcId,
        sourceHandle: "photo",
        target: genId,
        targetHandle: "base",
        style: { stroke: "#94a3b8", strokeWidth: 1.5 },
      });

      y += ROW_H;
    }
    y += 40;
  }

  // Restore saved edges (user-drawn references)
  const restoredEdges: Edge[] = dbEdges.map((e) => ({
    id: e.id,
    source: e.source_node,
    sourceHandle: e.source_handle ?? undefined,
    target: e.target_node,
    targetHandle: e.target_handle ?? undefined,
    style: {
      stroke: e.target_handle === "ref" ? "#f59e0b" : "#94a3b8",
      strokeWidth: 1.5,
      strokeDasharray: e.target_handle === "ref" ? "5 3" : undefined,
    },
  }));

  return { nodes, edges: [...autoEdges, ...restoredEdges] };
}

function loadSrcPositions(): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem("canvas-src-positions") ?? "{}"); } catch { return {}; }
}

function loadHiddenSources(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("canvas-hidden-sources") ?? "[]")); } catch { return new Set(); }
}

// Debounce canvas save
function useDebounce<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function StageCanvas({ userId: _userId }: { userId: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [noPhotos, setNoPhotos] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState(false);
  const initialized = useRef(false);
  const saveEnabled = useRef(false);
  const flowInstance = useRef<{ screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCanvas = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [photosRes, canvasRes] = await Promise.all([
        fetch("/api/photos"),
        fetch("/api/canvas"),
      ]);
      if (!photosRes.ok || !canvasRes.ok) throw new Error("Failed to load canvas data");

      const { photos }: { photos: PhotoRow[] } = await photosRes.json();
      const { generations: genRows, edges: edgeRows }: { generations: GenerationRow[]; edges: EdgeRow[] } =
        await canvasRes.json();

      if (!photos.length) {
        setNoPhotos(true);
        setLoading(false);
        return;
      }

      const srcPositions = loadSrcPositions();
      const hiddenSources = loadHiddenSources();
      const genMap = Object.fromEntries(genRows.map((g) => [g.filename, g]));
      const { nodes: n, edges: e } = buildNodesAndEdges(photos, genMap, edgeRows, srcPositions, hiddenSources);
      setNodes(n);
      setEdges(e);
      setLoading(false);
      setTimeout(() => { saveEnabled.current = true; }, 2000);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadCanvas();
    }
  }, [loadCanvas]);

  const debouncedEdges = useDebounce(edges, 1500);
  const debouncedNodes = useDebounce(nodes, 1500);

  useEffect(() => {
    if (saveState === "saved") {
      const t = setTimeout(() => setSaveState("idle"), 2000);
      return () => clearTimeout(t);
    }
  }, [saveState]);

  useEffect(() => {
    if (!saveEnabled.current || loading) return;
    setSaveState("saving");

    const srcPos: Record<string, { x: number; y: number }> = {};
    debouncedNodes.filter((n) => n.type === "sourceNode").forEach((n) => {
      srcPos[n.id] = { x: n.position.x, y: n.position.y };
    });
    try { localStorage.setItem("canvas-src-positions", JSON.stringify(srcPos)); } catch {}

    const userEdges = debouncedEdges.filter((e) => !e.id.startsWith("auto-"));
    const genPositions = debouncedNodes
      .filter((n) => n.type === "generationNode")
      .map((n) => {
        const nd = n.data as unknown as GenerationNodeData;
        return { filename: nd.filename, x: n.position.x, y: n.position.y, prompt: nd.prompt };
      });

    fetch("/api/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edges: userEdges, nodePositions: genPositions }),
    })
      .then((r) => (r.ok ? setSaveState("saved") : setSaveState("error")))
      .catch(() => setSaveState("error"));
  }, [debouncedEdges, debouncedNodes, loading]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            style: {
              stroke: connection.targetHandle === "ref" ? "#f59e0b" : "#94a3b8",
              strokeWidth: 1.5,
              strokeDasharray: connection.targetHandle === "ref" ? "5 3" : undefined,
            },
          },
          eds
        )
      ),
    [setEdges]
  );

  const seedPhotos = useCallback(async () => {
    setSeeding(true);
    await fetch("/api/setup");
    setNoPhotos(false);
    await loadCanvas();
    setSeeding(false);
  }, [loadCanvas]);

  const addNodesFromPhoto = useCallback(
    (photo: PhotoRow, position: { x: number; y: number }) => {
      const srcId = `src-${photo.filename}`;
      const genId = `gen-${photo.filename}`;

      // Unhide if previously hidden
      try {
        const hidden: string[] = JSON.parse(localStorage.getItem("canvas-hidden-sources") ?? "[]");
        const filtered = hidden.filter((id) => id !== srcId);
        localStorage.setItem("canvas-hidden-sources", JSON.stringify(filtered));
      } catch {}

      setNodes((nds) => {
        if (nds.some((n) => n.id === srcId)) return nds;
        const color = ZONE_COLORS[photo.zone] ?? ZONE_COLORS.unknown;
        const srcData: SourceNodeData = {
          filename: photo.filename,
          roomType: photo.room_type,
          label: photo.filename,
          photoUrl: `/api/photos/${encodeURIComponent(photo.filename)}`,
        };
        const genData: GenerationNodeData = {
          filename: photo.filename,
          roomType: photo.room_type,
          label: photo.filename,
          sourcePhotoUrl: `/api/photos/${encodeURIComponent(photo.filename)}`,
          prompt: photo.default_prompt,
          status: "idle",
        };
        return [
          ...nds,
          {
            id: srcId,
            type: "sourceNode",
            position,
            data: srcData as unknown as Record<string, unknown>,
            style: { borderColor: color },
          },
          {
            id: genId,
            type: "generationNode",
            position: { x: position.x + 280, y: position.y },
            data: genData as unknown as Record<string, unknown>,
            style: { borderColor: color },
          },
        ];
      });

      setEdges((eds) => {
        const autoId = `auto-${srcId}-${genId}`;
        if (eds.some((e) => e.id === autoId)) return eds;
        return addEdge(
          {
            id: autoId,
            source: srcId,
            sourceHandle: "photo",
            target: genId,
            targetHandle: "base",
            style: { stroke: "#94a3b8", strokeWidth: 1.5 },
          },
          eds
        );
      });
    },
    [setNodes, setEdges]
  );

  const uploadAndAddPhoto = useCallback(
    async (file: File, position: { x: number; y: number }) => {
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const dataUrl = e.target?.result as string;
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) { reject(new Error("Invalid file")); return; }
          const [, mimeType, b64] = match;
          try {
            const res = await fetch("/api/photos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: file.name, mimeType, b64 }),
            });
            if (!res.ok) throw new Error("Upload failed");
            const { photo } = await res.json();
            addNodesFromPhoto(photo, position);
            resolve();
          } catch (err) { reject(err); }
        };
        reader.readAsDataURL(file);
      });
    },
    [addNodesFromPhoto]
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (!files.length || !flowInstance.current) return;
      setUploading(true);
      const position = flowInstance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      try {
        for (let i = 0; i < files.length; i++) {
          await uploadAndAddPhoto(files[i], { x: position.x + i * 300, y: position.y });
        }
      } finally {
        setUploading(false);
      }
    },
    [uploadAndAddPhoto]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      setUploading(true);
      const center = flowInstance.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 400, y: 200 };
      try {
        for (let i = 0; i < files.length; i++) {
          await uploadAndAddPhoto(files[i], { x: center.x + i * 300, y: center.y });
        }
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [uploadAndAddPhoto]
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading canvas…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500">
        <AlertCircle size={40} className="text-red-300" />
        <p className="text-sm text-red-500">{loadError}</p>
        <Button onClick={loadCanvas} className="bg-violet-600 hover:bg-violet-700 text-white">
          Retry
        </Button>
      </div>
    );
  }

  if (noPhotos) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500">
        <Database size={40} className="text-slate-300" />
        <p className="text-sm">No photos in database yet.</p>
        <Button onClick={seedPhotos} disabled={seeding} className="bg-violet-600 hover:bg-violet-700 text-white">
          {seeding ? <><Loader2 size={14} className="mr-2 animate-spin" />Seeding…</> : "Seed photos from Source Photos/"}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Delete", "Backspace"]}
        onInit={(instance) => { flowInstance.current = instance; }}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.type === "sourceNode" ? "#94a3b8" : "#7c3aed")}
          className="!rounded-lg"
        />
        <Panel position="top-left">
          <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-sm border border-slate-200">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-violet-600 disabled:opacity-50 transition-colors"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Add Photo
            </button>
            <span className="w-px h-4 bg-slate-200" />
            {saveState === "saving" && (
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Loader2 size={10} className="animate-spin" /> Saving…
              </span>
            )}
            {saveState === "saved" && (
              <span className="flex items-center gap-1 text-xs text-emerald-500">
                <Check size={10} /> Saved
              </span>
            )}
            {saveState === "error" && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle size={10} /> Save failed
              </span>
            )}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
