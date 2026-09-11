"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/fixtures";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [tosAgreed, setTosAgreed] = useState(false);
  const [loading, setLoading] = useState<"password" | "magic" | "google" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consentRequired = mode === "signup";
  const consentGiven = !consentRequired || (ageConfirmed && tosAgreed);

  // Stamped once, at the moment of submission, so both fields share the exact same timestamp.
  function consentMetadata() {
    const now = new Date().toISOString();
    return { ageConfirmedAt: now, tosConsentedAt: now };
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consentGiven) return;
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
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}`,
              data: consentMetadata(),
            },
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
    if (!consentGiven) return;
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
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}`,
        ...(consentRequired ? { data: consentMetadata() } : {}),
      },
    });
    setLoading(null);
    if (error) {
      setError(error.message);
      return;
    }
    setMessage("Check your email for a magic sign-in link.");
  }

  async function handleGoogle() {
    if (!consentGiven) return;
    setError(null);
    setLoading("google");
    const supabase = createClient();

    // signInWithOAuth can't attach custom user_metadata directly (Google, not us, controls that
    // leg of the redirect), so the consent timestamps ride along as callback query params instead
    // — the callback route applies them via updateUser() once the session exists.
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", next);
    if (consentRequired) {
      const { ageConfirmedAt, tosConsentedAt } = consentMetadata();
      callbackUrl.searchParams.set("ageConsent", ageConfirmedAt);
      callbackUrl.searchParams.set("tosConsent", tosConsentedAt);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl.toString() },
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

        {consentRequired && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-start gap-2">
              <Checkbox
                id="age-consent"
                checked={ageConfirmed}
                onCheckedChange={(checked) => setAgeConfirmed(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="age-consent" className="text-sm leading-snug font-normal">
                I confirm I am 18 years of age or older.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="tos-consent"
                checked={tosAgreed}
                onCheckedChange={(checked) => setTosAgreed(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="tos-consent" className="text-sm leading-snug font-normal">
                I agree to the{" "}
                <Link href="/terms" target="_blank" className="underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" target="_blank" className="underline">
                  Privacy Policy
                </Link>
                .
              </Label>
            </div>
          </div>
        )}

        <Button type="submit" disabled={loading !== null || !consentGiven}>
          {mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        or
        <Separator className="flex-1" />
      </div>

      <Button variant="outline" onClick={handleMagicLink} disabled={loading !== null || !consentGiven}>
        Send me a magic link
      </Button>
      <Button variant="outline" onClick={handleGoogle} disabled={loading !== null || !consentGiven}>
        Continue with Google
      </Button>

      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
