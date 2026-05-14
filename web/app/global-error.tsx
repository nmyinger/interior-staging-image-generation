"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html><body>
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h2 className="text-lg font-semibold text-stone-800">Something went wrong</h2>
        <button onClick={reset} className="text-sm text-stone-500 underline">Try again</button>
      </div>
    </body></html>
  );
}
