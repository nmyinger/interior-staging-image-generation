import { createContext } from "react";

export interface CanvasContextValue {
  sessionId: string;
  readOnly: boolean;
  isDemo: boolean;
}

export const CanvasContext = createContext<CanvasContextValue>({ sessionId: "", readOnly: false, isDemo: false });
