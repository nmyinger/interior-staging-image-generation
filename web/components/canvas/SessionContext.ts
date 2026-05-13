import { createContext } from "react";

export interface SessionContextValue {
  sessionId: string;
  readOnly: boolean;
}

export const SessionContext = createContext<SessionContextValue>({ sessionId: "", readOnly: false });
