"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  addEdge,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Upload, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

import { SourceNode } from "./SourceNode";
import { GenerationNode } from "./GenerationNode";
import { DeletableEdge } from "./DeletableEdge";
import { MenuBar } from "./MenuBar";
import { NodeSettingsPanel } from "./NodeSettingsPanel";
import { SessionContext } from "./SessionContext";
import type { PhotoNodeData, GenerationNodeData } from "@/types/nodes";

const nodeTypes: NodeTypes = {
  photo: SourceNode,
  generation: GenerationNode,
};

const edgeTypes = { deletable: DeletableEdge };

type SaveState = "idle" | "saving" | "saved" | "error";

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function useDebounce<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const miniMapNodeColor = (n: { type?: string }) =>
  n.type === "photo" ? "#a8a29e" : "#6b8a68";

function edgeStyle(targetHandle?: string | null) {
  const isRef = targetHandle === "ref";
  return {
    stroke: isRef ? "var(--color-acacia-400)" : "var(--color-stone-400)",
    strokeWidth: 2,
    strokeDasharray: isRef ? "6 3" : undefined,
  };
}

interface DBNode {
  id: string;
  type: string;
  x: number;
  y: number;
  data: Record<string, unknown>;
}

interface DBEdge {
  id: string;
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
}

export function StageCanvas({ sessionId }: { sessionId: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const initialized = useRef(false);
  const saveEnabled = useRef(false);
  const dragCounter = useRef(0);
  const flowInstance = useRef<{ screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Undo history — stable refs so snapshot/undo never need to be recreated
  const history = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const snapshot = useCallback(() => {
    history.current = [...history.current.slice(-29), { nodes: nodesRef.current, edges: edgesRef.current }];
  }, []);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [setNodes, setEdges]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "z" || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      e.preventDefault();
      undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo]);

  const loadCanvas = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/canvas?sessionId=${sessionId}`);
      if (!res.ok) throw new Error("Failed to load canvas");
      const { nodes: dbNodes, edges: dbEdges }: { nodes: DBNode[]; edges: DBEdge[] } = await res.json();

      const rfNodes: Node[] = dbNodes.map(n => {
        if (n.type === "photo") {
          const data: PhotoNodeData = {
            filename: n.data.filename as string,
            photoUrl: `/api/photos/${encodeURIComponent(n.data.filename as string)}?w=400`,
          };
          return { id: n.id, type: "photo", position: { x: n.x, y: n.y }, data: data as unknown as Record<string, unknown> };
        } else {
          const outputB64 = n.data.outputB64 as string | undefined;
          const data: GenerationNodeData = {
            prompt: (n.data.prompt as string) ?? "",
            status: n.data.status === "done" ? "done" : "idle",
            model: n.data.model as string | undefined,
            outputB64,
            outputImageUrl: outputB64 ? `data:image/jpeg;base64,${outputB64}` : undefined,
          };
          return { id: n.id, type: "generation", position: { x: n.x, y: n.y }, data: data as unknown as Record<string, unknown> };
        }
      });

      // Filter out orphan edges whose source or target nodes no longer exist
      const nodeIds = new Set(rfNodes.map(n => n.id));
      const rfEdges: Edge[] = dbEdges
        .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map(e => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.source_handle,
          target: e.target,
          targetHandle: e.target_handle,
          type: "deletable",
          interactionWidth: 20,
          style: edgeStyle(e.target_handle),
        }));

      setNodes(rfNodes);
      setEdges(rfEdges);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setTimeout(() => { saveEnabled.current = true; }, 1500);
    }
  }, [sessionId, setNodes, setEdges]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadCanvas();
    }
  }, [loadCanvas]);

  const debouncedEdges = useDebounce(edges, 500);
  const debouncedNodes = useDebounce(nodes, 500);

  useEffect(() => {
    if (saveState === "saved") {
      const t = setTimeout(() => setSaveState("idle"), 2000);
      return () => clearTimeout(t);
    }
  }, [saveState]);

  // Debounced save: serialize all nodes + edges to DB
  useEffect(() => {
    if (!saveEnabled.current || loading) return;
    setSaveState("saving");

    const dbNodes = debouncedNodes.map(n => {
      const type = n.type as string;
      let data: Record<string, unknown>;
      if (type === "photo") {
        const d = n.data as unknown as PhotoNodeData;
        data = { filename: d.filename };
      } else {
        const d = n.data as unknown as GenerationNodeData;
        data = {
          prompt: d.prompt ?? "",
          status: d.status === "done" ? "done" : "idle",
          ...(d.model ? { model: d.model } : {}),
          ...(d.outputB64 ? { outputB64: d.outputB64 } : {}),
        };
      }
      return { id: n.id, type, x: n.position.x, y: n.position.y, data };
    });

    const dbEdges = debouncedEdges.map(e => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? "output",
      target: e.target,
      targetHandle: e.targetHandle ?? "input",
    }));

    fetch("/api/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, nodes: dbNodes, edges: dbEdges }),
    })
      .then(r => (r.ok ? setSaveState("saved") : setSaveState("error")))
      .catch(() => setSaveState("error"));
  }, [debouncedEdges, debouncedNodes, loading, sessionId]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some(c => c.type === "remove")) snapshot();
    onNodesChange(changes);
  }, [onNodesChange, snapshot]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some(c => c.type === "remove")) snapshot();
    onEdgesChange(changes);
  }, [onEdgesChange, snapshot]);

  const onConnect = useCallback(
    (connection: Connection) => {
      snapshot();
      setEdges(eds =>
        addEdge(
          {
            ...connection,
            type: "deletable",
            interactionWidth: 20,
            style: edgeStyle(connection.targetHandle),
          },
          eds
        )
      );
    },
    [setEdges, snapshot]
  );

  // Upload a file and add a photo node at the given canvas position
  const createPhotoNode = useCallback(
    async (file: File, position: { x: number; y: number }) => {
      return new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async e => {
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
            const data: PhotoNodeData = {
              filename: photo.filename,
              photoUrl: `/api/photos/${encodeURIComponent(photo.filename)}?w=400`,
            };
            snapshot();
            setNodes(nds => [
              ...nds,
              { id: newId(), type: "photo", position, data: data as unknown as Record<string, unknown> },
            ]);
            resolve();
          } catch (err) { reject(err); }
        };
        reader.readAsDataURL(file);
      });
    },
    [setNodes, snapshot]
  );

  // Add an empty generation node at canvas center
  const handleAddGenerationNode = useCallback(() => {
    snapshot();
    const pos = flowInstance.current?.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }) ?? { x: 400, y: 200 };
    const data: GenerationNodeData = { prompt: "", status: "idle" };
    setNodes(nds => [
      ...nds,
      { id: newId(), type: "generation", position: pos, data: data as unknown as Record<string, unknown> },
    ]);
  }, [setNodes, snapshot]);

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).filter(f => f.type.startsWith("image/"));
      if (!files.length) return;
      setUploading(true);
      const center = flowInstance.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 100, y: 100 };
      try {
        for (let i = 0; i < files.length; i++) {
          await createPhotoNode(files[i], { x: center.x + i * 260, y: center.y });
        }
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [createPhotoNode]
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      dragCounter.current = 0;
      setIsDraggingFile(false);
      const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith("image/"));
      if (!files.length || !flowInstance.current) return;
      setUploading(true);
      const pos = flowInstance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      try {
        for (let i = 0; i < files.length; i++) {
          await createPhotoNode(files[i], { x: pos.x + i * 260, y: pos.y });
        }
      } finally {
        setUploading(false);
      }
    },
    [createPhotoNode]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current += 1;
    const hasFiles = Array.from(event.dataTransfer.items).some(
      item => item.kind === "file" && item.type.startsWith("image/")
    );
    if (hasFiles) setIsDraggingFile(true);
  }, []);

  const onDragLeave = useCallback(() => {
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingFile(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-stone-400">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading canvas…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-stone-500">
        <AlertCircle size={40} className="text-clay-400" />
        <p className="text-sm text-clay-500">{loadError}</p>
        <Button onClick={loadCanvas} className="bg-sage-600 hover:bg-sage-700 text-white">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={sessionId}>
      <div className="w-full h-full relative">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        {isDraggingFile && (
          <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center bg-stone-50/80 border-2 border-dashed border-stone-300 rounded-lg m-2">
            <Upload size={28} className="text-stone-400" />
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={snapshot}
          onSelectionChange={({ nodes: sel }) => setSelectedNodeId(sel[0]?.id ?? null)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          deleteKeyCode={["Delete", "Backspace"]}
          onInit={instance => { flowInstance.current = instance; }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
        >
          <Background gap={20} color="var(--color-stone-200)" />
          <MiniMap nodeColor={miniMapNodeColor} className="!rounded-lg" />
          <MenuBar
            onUpload={() => fileInputRef.current?.click()}
            onAddNode={handleAddGenerationNode}
            uploading={uploading}
            saveState={saveState}
          />
          {selectedNodeId && nodes.find(n => n.id === selectedNodeId)?.type === "generation" && (
            <NodeSettingsPanel selectedNodeId={selectedNodeId} />
          )}
        </ReactFlow>
      </div>
    </SessionContext.Provider>
  );
}
