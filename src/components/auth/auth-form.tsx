"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/fixtures";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<"password" | "magic" | "google" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading("password");
    const supabase = createClient();

    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}` },
          });

    setLoading(null);
    if (error) {
      setError(error.message);
      return;
    }
    if (mode === "signup") {
      setMessage("Check your email to confirm your account.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function handleMagicLink() {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setError(null);
    setMessage(null);
    setLoading("magic");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
    setLoading(null);
    if (error) {
      setError(error.message);
      return;
    }
    setMessage("Check your email for a magic sign-in link.");
  }

  async function handleGoogle() {
    setError(null);
    setLoading("google");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
    if (error) {
      setLoading(null);
      setError(error.message);
    }
    // On success the browser navigates away to Google, so no further action needed here.
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button type="submit" disabled={loading !== null}>
          {mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        or
        <Separator className="flex-1" />
      </div>

      <Button variant="outline" onClick={handleMagicLink} disabled={loading !== null}>
        Send me a magic link
      </Button>
      <Button variant="outline" onClick={handleGoogle} disabled={loading !== null}>
        Continue with Google
      </Button>

      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
