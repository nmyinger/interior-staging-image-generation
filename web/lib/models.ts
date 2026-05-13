export const GENERATION_MODELS = [
  {
    id: "gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash",
    provider: "Gemini",
    note: "4K output, fast generation",
  },
  {
    id: "gemini-3-pro-image-preview",
    label: "Gemini 3 Pro",
    provider: "Gemini",
    note: "Studio-quality, precise text",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash",
    provider: "Gemini",
    note: "Stable, creative workflows",
  },
] as const;

export type ModelId = typeof GENERATION_MODELS[number]["id"];
export const DEFAULT_MODEL_ID: ModelId = GENERATION_MODELS[0].id;
export const ALLOWED_MODEL_IDS: readonly ModelId[] = GENERATION_MODELS.map(m => m.id);
