/**
 * Validates that a `next`-style redirect target is a same-origin relative path, never an
 * absolute URL to a different origin. Used everywhere a caller-supplied `next` query param feeds
 * into a redirect (login/signup, the OAuth callback, the consent interstitial) — none of those
 * should trust an unvalidated redirect target (CWE-601 open redirect via e.g. `?next=https://
 * evil.example`), and validating up front also stops a value containing `&`/`=` from injecting
 * extra query params into a URL built by string concatenation further down the chain.
 *
 * A "starts with one slash" check is not enough: browsers treat "\" like "/" and silently drop
 * tabs/newlines, so "/\evil.example" and "/<TAB>/evil.example" both resolve to evil.example
 * (confirmed 2026-09-24). So the value is actually resolved as a URL against a placeholder origin,
 * and only accepted if it stays on that origin; what's returned is the normalized path.
 */
const PLACEHOLDER_ORIGIN = "http://same-origin.invalid";

export function safeRedirectPath(value: string | null | undefined, fallback = "/home"): string {
  if (!value) return fallback;
  // Must start with exactly one "/" and contain no backslashes or control characters at all.
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
