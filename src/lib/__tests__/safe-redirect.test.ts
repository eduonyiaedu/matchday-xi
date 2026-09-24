import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it("passes through a normal relative path", () => {
    expect(safeRedirectPath("/predict/abc-123")).toBe("/predict/abc-123");
  });

  it("falls back to the default for null/undefined/empty", () => {
    expect(safeRedirectPath(null)).toBe("/home");
    expect(safeRedirectPath(undefined)).toBe("/home");
    expect(safeRedirectPath("")).toBe("/home");
  });

  it("honors a custom fallback", () => {
    expect(safeRedirectPath(null, "/login")).toBe("/login");
  });

  it("rejects an absolute URL to a different origin (open redirect)", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/home");
    expect(safeRedirectPath("http://evil.example/phish")).toBe("/home");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeRedirectPath("//evil.example")).toBe("/home");
  });

  it("rejects a value that doesn't start with a slash", () => {
    expect(safeRedirectPath("evil.example")).toBe("/home");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/home");
  });

  it("rejects backslash and control-character tricks browsers resolve to another host", () => {
    // Browsers treat "\" as "/" and drop tabs/newlines: both of these resolve to evil.example.
    expect(safeRedirectPath("/\\evil.example")).toBe("/home");
    expect(safeRedirectPath("/\t/evil.example")).toBe("/home");
    expect(safeRedirectPath("/\n/evil.example")).toBe("/home");
    expect(safeRedirectPath("/\\/evil.example")).toBe("/home");
    // What the app's own login page receives from ?next=/%5Cevil.example after decoding.
    expect(safeRedirectPath(decodeURIComponent("/%5Cevil.example"))).toBe("/home");
    expect(safeRedirectPath(decodeURIComponent("/%09/evil.example"))).toBe("/home");
  });

  it("keeps legitimate same-origin paths, with query and hash", () => {
    expect(safeRedirectPath("/leagues/abc?tab=history#standings")).toBe("/leagues/abc?tab=history#standings");
  });

  it("does not itself strip a query string — that's the caller's job via URLSearchParams", () => {
    // safeRedirectPath only guards against a DIFFERENT origin; a same-origin path carrying its
    // own query string is legitimate (e.g. a deep link) and passed through unchanged.
    expect(safeRedirectPath("/predict/abc?tab=history")).toBe("/predict/abc?tab=history");
  });
});
