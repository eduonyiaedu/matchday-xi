/**
 * Validates that a `next`-style redirect target is a same-origin relative path, never an
 * absolute URL to a different origin. Used everywhere a caller-supplied `next` query param feeds
 * into a redirect (login/signup, the OAuth callback, the consent interstitial) — none of those
 * should trust an unvalidated redirect target (CWE-601 open redirect via e.g. `?next=https://
 * evil.example`), and validating up front also stops a value containing `&`/`=` from injecting
 * extra query params into a URL built by string concatenation further down the chain.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = "/home"): string {
  if (!value) return fallback;
  // Must start with exactly one "/" — rejects absolute URLs ("https://...") and
  // protocol-relative ones ("//evil.example", which browsers resolve using the current
  // protocol against that host, not this app).
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
