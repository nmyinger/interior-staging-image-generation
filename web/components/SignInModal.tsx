"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { APP_WORDMARK } from "@/lib/constants";

interface SignInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callbackUrl?: string;
  message?: string;
}

type View = "signin" | "register";

export function SignInModal({ open, onOpenChange, callbackUrl = "/properties", message }: SignInModalProps) {
  const [view, setView] = useState<View>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function resetForm() {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setLoading(false);
  }

  function switchView(next: View) {
    resetForm();
    setView(next);
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await signIn("credentials", { email, password, callbackUrl, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Invalid email or password");
    } else if (result?.ok) {
      window.location.href = callbackUrl;
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Registration failed");
      return;
    }
    const result = await signIn("credentials", { email, password, callbackUrl, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Account created — please sign in");
      switchView("signin");
    } else if (result?.ok) {
      window.location.href = callbackUrl;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xs" showCloseButton={false}>
        <div className="flex flex-col items-center gap-5 py-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sage-600 flex items-center justify-center shrink-0">
              <span className="text-white text-base font-bold">VS</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-800">{APP_WORDMARK}</p>
              <p className="text-xs text-stone-400">AI-powered interior staging</p>
            </div>
          </div>

          {message && view === "signin" && (
            <p className="text-sm text-stone-600 text-center">{message}</p>
          )}

          {view === "signin" ? (
            <>
              <Button
                variant="outline"
                onClick={() => signIn("google", { callbackUrl })}
                className="w-full gap-3 shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </Button>

              <div className="flex items-center gap-3 w-full">
                <div className="flex-1 h-px bg-stone-200" />
                <span className="text-xs text-stone-400">or</span>
                <div className="flex-1 h-px bg-stone-200" />
              </div>

              <form onSubmit={handleEmailSignIn} className="w-full space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                {error && <p className="text-xs text-clay-600">{error}</p>}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </form>

              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => switchView("register")}
                  className="text-xs text-stone-500 hover:text-stone-700 transition-colors"
                >
                  Don&apos;t have an account? <span className="font-medium">Create one</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
                >
                  Maybe later
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-stone-700 self-start -mb-2">Create your account</p>

              <form onSubmit={handleRegister} className="w-full space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">Email</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-password">Password</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-confirm">Confirm password</Label>
                  <Input
                    id="reg-confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                {error && <p className="text-xs text-clay-600">{error}</p>}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating account…" : "Create account"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => switchView("signin")}
                className="text-xs text-stone-500 hover:text-stone-700 transition-colors"
              >
                Already have an account? <span className="font-medium">Sign in</span>
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
