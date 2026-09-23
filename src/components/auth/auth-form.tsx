"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { TurnstileWidget, TURNSTILE_SITE_KEY } from "@/components/auth/turnstile-widget";

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

// Built with URL/searchParams.set (never raw string interpolation) so `next` — a caller-supplied
// value, already validated as a safe relative path by safeRedirectPath, but validated once
// doesn't mean safe to concatenate — can never break out of its own query param and inject
// extra ones into the callback URL Supabase eventually redirects back to.
function buildCallbackUrl(origin: string, next: string): URL {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", next);
  return url;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirectPath(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [tosAgreed, setTosAgreed] = useState(false);
  const [loading, setLoading] = useState<"password" | "magic" | "google" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bot check for the email paths (Google has its own) — only when a Turnstile key is configured.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const captchaReady = !TURNSTILE_SITE_KEY || captchaToken !== null;
  /** Tokens are single-use — get a fresh one after every attempt. */
  function resetCaptcha() {
    if (!TURNSTILE_SITE_KEY) return;
    setCaptchaToken(null);
    setCaptchaKey((k) => k + 1);
  }
  const captchaOption = captchaToken ? { captchaToken } : {};

  const consentRequired = mode === "signup";
  const usernameFormatValid = !consentRequired || USERNAME_PATTERN.test(username);
  const consentGiven = !consentRequired || (ageConfirmed && tosAgreed && usernameFormatValid);

  // Stamped once, at the moment of submission, so both fields share the exact same timestamp.
  function signupMetadata() {
    const now = new Date().toISOString();
    return { ageConfirmedAt: now, tosConsentedAt: now, username };
  }

  /** Checked right before every signup path fires — the format check above is just UX polish. */
  async function ensureUsernameAvailable(): Promise<boolean> {
    if (!USERNAME_PATTERN.test(username)) {
      setError("Username must be 3-20 characters: lowercase letters, numbers, underscore only.");
      return false;
    }
    const res = await fetch("/api/auth/check-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.available) {
      setError("That username is already taken.");
      return false;
    }
    return true;
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consentGiven) return;
    setError(null);
    setMessage(null);
    if (consentRequired && !(await ensureUsernameAvailable())) return;
    setLoading("password");
    const supabase = createClient();

    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password, options: captchaOption })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: buildCallbackUrl(window.location.origin, next).toString(),
              data: signupMetadata(),
              ...captchaOption,
            },
          });

    setLoading(null);
    resetCaptcha();
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
    if (consentRequired && !(await ensureUsernameAvailable())) return;
    setLoading("magic");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: buildCallbackUrl(window.location.origin, next).toString(),
        ...(consentRequired ? { data: signupMetadata() } : {}),
        ...captchaOption,
      },
    });
    setLoading(null);
    resetCaptcha();
    if (error) {
      setError(error.message);
      return;
    }
    setMessage("Check your email for a magic sign-in link.");
  }

  async function handleGoogle() {
    if (!consentGiven) return;
    setError(null);
    if (consentRequired && !(await ensureUsernameAvailable())) return;
    setLoading("google");
    const supabase = createClient();

    // signInWithOAuth can't attach custom user_metadata directly (Google, not us, controls that
    // leg of the redirect), so consent timestamps + username ride along as callback query params
    // instead — the callback route applies them via updateUser() once the session exists.
    const callbackUrl = buildCallbackUrl(window.location.origin, next);
    if (consentRequired) {
      const { ageConfirmedAt, tosConsentedAt } = signupMetadata();
      callbackUrl.searchParams.set("ageConsent", ageConfirmedAt);
      callbackUrl.searchParams.set("tosConsent", tosConsentedAt);
      callbackUrl.searchParams.set("username", username);
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              required
              minLength={3}
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="e.g. redsfan92"
            />
            <p className="text-xs text-muted-foreground">
              3-20 characters: lowercase letters, numbers, underscore. Shown alongside your name.
            </p>
          </div>
        )}

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

        <TurnstileWidget key={captchaKey} onToken={setCaptchaToken} />

        <Button type="submit" disabled={loading !== null || !consentGiven || !captchaReady}>
          {mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        or
        <Separator className="flex-1" />
      </div>

      <Button variant="outline" onClick={handleMagicLink} disabled={loading !== null || !consentGiven || !captchaReady}>
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
