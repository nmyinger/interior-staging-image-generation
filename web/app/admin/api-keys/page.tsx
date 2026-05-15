"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Revealed key after creation
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Revoke state
  const [revoking, setRevoking] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Fetch keys
  // -------------------------------------------------------------------------
  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/keys");
      if (!res.ok) throw new Error(`Failed to fetch keys: ${res.status}`);
      const data = await res.json() as { keys: ApiKey[] };
      setKeys(data.keys ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  // -------------------------------------------------------------------------
  // Create key
  // -------------------------------------------------------------------------
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json() as { raw_key: string };
      setRevealedKey(data.raw_key);
      setNewKeyName("");
      setShowCreateForm(false);
      await fetchKeys();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  // -------------------------------------------------------------------------
  // Revoke key
  // -------------------------------------------------------------------------
  async function handleRevoke(id: string, name: string) {
    if (!window.confirm(`Revoke "${name}"? This cannot be undone.`)) return;

    setRevoking(id);
    try {
      const res = await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      await fetchKeys();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setRevoking(null);
    }
  }

  // -------------------------------------------------------------------------
  // Copy to clipboard
  // -------------------------------------------------------------------------
  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Page title */}
        <div>
          <h1 className="text-xl font-semibold text-stone-800">API Keys</h1>
          <p className="text-sm text-stone-400 mt-1">
            Use API keys to integrate with your delivery platform or Lightroom workflow.
          </p>
        </div>

        {/* Revealed key callout — shown ONE TIME after creation */}
        {revealedKey && (
          <div className="bg-acacia-100 border border-acacia-200 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-acacia-500 mt-0.5 shrink-0">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="8" cy="11" r="0.75" fill="currentColor" />
              </svg>
              <p className="text-sm font-semibold text-stone-700">
                Copy this key — it won&apos;t be shown again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs text-stone-700 bg-white border border-acacia-200 rounded px-3 py-2 break-all">
                {revealedKey}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg border border-acacia-200 bg-white text-stone-700 hover:bg-acacia-100 transition-colors min-w-[68px]"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <button
              onClick={() => setRevealedKey(null)}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create button / inline form */}
        <div>
          {!showCreateForm ? (
            <Button
              onClick={() => {
                setShowCreateForm(true);
                setCreateError(null);
              }}
              size="sm"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Create API Key
            </Button>
          ) : (
            <form
              onSubmit={handleCreate}
              className="bg-white border border-stone-200 rounded-xl px-5 py-4 space-y-3"
            >
              <p className="text-sm font-semibold text-stone-700">New API Key</p>
              <div className="flex items-center gap-3">
                <Input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g. Lightroom Workflow)"
                  maxLength={100}
                  autoFocus
                  className="flex-1"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={creating || !newKeyName.trim()}
                >
                  {creating ? "Creating…" : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewKeyName("");
                    setCreateError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              {createError && (
                <p className="text-xs text-clay-500">{createError}</p>
              )}
            </form>
          )}
        </div>

        {/* Keys list */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-stone-400">Loading…</div>
          ) : error ? (
            <div className="px-5 py-10 text-center text-sm text-clay-500">{error}</div>
          ) : keys.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-stone-400">
                No API keys yet. Create one to start integrating.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                    Key prefix
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                    Last used
                  </th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {keys.map((key) => (
                  <tr key={key.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-5 py-3.5 text-stone-800 font-medium text-sm">
                      {key.name}
                    </td>
                    <td className="px-5 py-3.5">
                      <code className="font-mono text-xs text-stone-600">
                        isk_live_{key.key_prefix}…
                      </code>
                    </td>
                    <td className="px-5 py-3.5 text-stone-500 text-xs">
                      {formatDate(key.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-stone-400 text-xs">
                      {formatDate(key.last_used_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleRevoke(key.id, key.name)}
                        disabled={revoking === key.id}
                        className="text-xs font-semibold text-clay-500 hover:text-clay-600 disabled:opacity-50 transition-colors"
                      >
                        {revoking === key.id ? "Revoking…" : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
