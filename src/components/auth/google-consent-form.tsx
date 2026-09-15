"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function GoogleConsentForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [tosAgreed, setTosAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameFormatValid = USERNAME_PATTERN.test(username);
  const canSubmit = usernameFormatValid && ageConfirmed && tosAgreed;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/complete-google-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
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

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={!canSubmit || loading}>
        {loading ? "Continuing..." : "Continue"}
      </Button>
    </form>
  );
}
