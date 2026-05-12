export type NodeStatus = "idle" | "generating" | "done" | "error";

export interface SourceNodeData {
  filename: string;
  roomType: string;
  label: string;
  photoUrl: string;
}

export interface GenerationNodeData {
  filename: string;
  roomType: string;
  label: string;
  sourcePhotoUrl: string;
  prompt: string;
  status: NodeStatus;
  outputImageUrl?: string;
  error?: string;
}
