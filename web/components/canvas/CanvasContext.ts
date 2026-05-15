import { createContext } from "react";

export interface CanvasContextValue {
  sessionId: string;
  readOnly: boolean;
}

export const CanvasContext = createContext<CanvasContextValue>({ sessionId: "", readOnly: false });
