export type NodeStatus = "idle" | "generating" | "done" | "error";

export const DEFAULT_MODEL_ID = "gemini-3.1-flash-image-preview";

export interface PhotoNodeData {
  filename: string;
  photoUrl?: string; // computed at load time, not persisted
}

export interface GenerationNodeData {
  prompt: string;
  status: NodeStatus;
  model?: string;            // persisted — model ID used for generation
  outputB64?: string;        // persisted in canvas_nodes.data
  outputImageUrl?: string;   // derived from outputB64 at load time, not persisted
  error?: string;            // transient UI state, not persisted
}
