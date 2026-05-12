"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Database } from "lucide-react";
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

function buildNodesAndEdges(
  photos: PhotoRow[],
  generations: Record<string, GenerationRow>,
  dbEdges: EdgeRow[]
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
      const saved = generations[photo.filename];
      const genY = saved ? saved.node_y : y;

      const srcData: SourceNodeData = {
        filename: photo.filename,
        roomType: photo.room_type,
        label: photo.filename,
        photoUrl: `/api/photos/${encodeURIComponent(photo.filename)}`,
      };
      nodes.push({
        id: srcId,
        type: "sourceNode",
        position: { x: COL_X.source, y: genY },
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

// Debounce canvas save
function useDebounce<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function StageCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [noPhotos, setNoPhotos] = useState(false);
  const initialized = useRef(false);

  const loadCanvas = useCallback(async () => {
    setLoading(true);
    const [photosRes, canvasRes] = await Promise.all([
      fetch("/api/photos"),
      fetch("/api/canvas"),
    ]);
    const { photos }: { photos: PhotoRow[] } = await photosRes.json();
    const { generations: genRows, edges: edgeRows }: { generations: GenerationRow[]; edges: EdgeRow[] } =
      await canvasRes.json();

    if (!photos.length) {
      setNoPhotos(true);
      setLoading(false);
      return;
    }

    const genMap = Object.fromEntries(genRows.map((g) => [g.filename, g]));
    const { nodes: n, edges: e } = buildNodesAndEdges(photos, genMap, edgeRows);
    setNodes(n);
    setEdges(e);
    setLoading(false);
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadCanvas();
    }
  }, [loadCanvas]);

  // Save canvas state (edges + generation node positions) on change
  const debouncedEdges = useDebounce(edges, 1500);
  const debouncedNodes = useDebounce(nodes, 1500);
  const isSaving = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (isSaving.current) return;
    isSaving.current = true;

    const userEdges = debouncedEdges.filter((e) => !e.id.startsWith("auto-"));
    const genPositions = debouncedNodes
      .filter((n) => n.type === "generationNode")
      .map((n) => ({
        filename: (n.data as unknown as GenerationNodeData).filename,
        x: n.position.x,
        y: n.position.y,
      }));

    fetch("/api/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edges: userEdges, nodePositions: genPositions }),
    }).finally(() => {
      isSaving.current = false;
    });
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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading canvas…
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
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.type === "sourceNode" ? "#94a3b8" : "#7c3aed")}
          className="!rounded-lg"
        />
      </ReactFlow>
    </div>
  );
}
