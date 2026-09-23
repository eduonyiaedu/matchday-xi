import { describe, expect, it } from "vitest";
import { isDisposableEmail, normalizeEmail } from "@/lib/account-trust";

describe("normalizeEmail", () => {
  it("treats Gmail dot and +tag variants as one inbox", () => {
    expect(normalizeEmail("J.Smith+prizes2@gmail.com")).toBe("jsmith@gmail.com");
    expect(normalizeEmail("jsmith@googlemail.com")).toBe("jsmith@gmail.com");
    expect(normalizeEmail("  JSMITH@GMAIL.COM ")).toBe("jsmith@gmail.com");
  });

  it("drops +tags for other providers but keeps their dots", () => {
    expect(normalizeEmail("first.last+x@outlook.com")).toBe("first.last@outlook.com");
    expect(normalizeEmail("first.last@outlook.com")).not.toBe(normalizeEmail("firstlast@outlook.com"));
  });

  it("leaves a malformed address as-is (lower-cased)", () => {
    expect(normalizeEmail("NoAtSign")).toBe("noatsign");
  });
});

describe("isDisposableEmail", () => {
  it("recognises throwaway inbox services", () => {
    expect(isDisposableEmail("someone@mailinator.com")).toBe(true);
    expect(isDisposableEmail("SOMEONE+1@YOPMAIL.COM")).toBe(true);
  });

  it("doesn't flag ordinary providers", () => {
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
    expect(isDisposableEmail("someone@company.co.uk")).toBe(false);
  });
});
