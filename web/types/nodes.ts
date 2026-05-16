export type NodeStatus = "idle" | "generating" | "done" | "error";

export interface PhotoNodeData {
  filename: string;
  photoUrl?: string;  // computed at load time, not persisted
  assetId?: string;   // unified model: asset ID
  blobUrl?: string;   // unified model: raw blob URL (proxied via blob-proxy, never used directly in <img>)
}

export interface GenerationNodeData {
  prompt: string;
  status: NodeStatus;
  model?: string;            // persisted — model ID used for generation
  outputUrl?: string;        // persisted in canvas_nodes.data — blob URL (new)
  outputB64?: string;        // persisted in canvas_nodes.data — base64 (legacy, kept for existing rows)
  outputImageUrl?: string;   // derived at load time from outputUrl or outputB64; never persisted
  error?: string;            // transient UI state, not persisted
}
