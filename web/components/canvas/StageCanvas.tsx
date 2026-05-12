"use client";

import { useCallback, useEffect, useMemo } from "react";
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

import { SourceNode } from "./SourceNode";
import { GenerationNode } from "./GenerationNode";
import type { SourceNodeData, GenerationNodeData } from "@/types/nodes";

const nodeTypes: NodeTypes = {
  sourceNode: SourceNode,
  generationNode: GenerationNode,
};

interface PhotoMeta {
  filename: string;
  roomType: string;
  zone: string;
  prompt: string;
}

const ZONE_COLORS: Record<string, string> = {
  open_plan: "#7c3aed",
  bedroom: "#0284c7",
  bathroom_suite: "#0891b2",
  unknown: "#64748b",
};

const COL_X = { source: 60, gen: 320 };
const ROW_H = 260;

function buildNodes(photos: PhotoMeta[]) {
  const nodes = [];
  const edges = [];
  let y = 40;

  // Group by zone for visual separation
  const byZone: Record<string, PhotoMeta[]> = {};
  for (const p of photos) {
    (byZone[p.zone] ??= []).push(p);
  }

  for (const [zone, group] of Object.entries(byZone)) {
    const color = ZONE_COLORS[zone] ?? ZONE_COLORS.unknown;

    for (const photo of group) {
      const srcId = `src-${photo.filename}`;
      const genId = `gen-${photo.filename}`;

      const srcData: SourceNodeData = {
        filename: photo.filename,
        roomType: photo.roomType,
        label: photo.filename,
        photoUrl: `/api/photos/${encodeURIComponent(photo.filename)}`,
      };
      nodes.push({
        id: srcId,
        type: "sourceNode",
        position: { x: COL_X.source, y },
        data: srcData as unknown as Record<string, unknown>,
        style: { borderColor: color },
      });

      const genData: GenerationNodeData = {
        filename: photo.filename,
        roomType: photo.roomType,
        label: photo.filename,
        sourcePhotoUrl: `/api/photos/${encodeURIComponent(photo.filename)}`,
        prompt: photo.prompt,
        status: "idle",
      };
      nodes.push({
        id: genId,
        type: "generationNode",
        position: { x: COL_X.gen, y },
        data: genData as unknown as Record<string, unknown>,
        style: { borderColor: color },
      });

      // Auto-wire source → generation base input
      edges.push({
        id: `e-${srcId}-${genId}`,
        source: srcId,
        sourceHandle: "photo",
        target: genId,
        targetHandle: "base",
        style: { stroke: "#94a3b8", strokeWidth: 1.5 },
      });

      y += ROW_H;
    }
    y += 40; // gap between zones
  }

  return { nodes, edges };
}

export function StageCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    fetch("/api/photos")
      .then((r) => r.json())
      .then(({ photos }: { photos: PhotoMeta[] }) => {
        const { nodes: n, edges: e } = buildNodes(photos);
        setNodes(n);
        setEdges(e);
      })
      .catch(console.error);
  }, [setNodes, setEdges]);

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
          nodeColor={(n) =>
            n.type === "sourceNode" ? "#94a3b8" : "#7c3aed"
          }
          className="!rounded-lg"
        />
      </ReactFlow>
    </div>
  );
}
