/**
 * A random, first-party device identifier kept in a cookie (set by the proxy on the first visit),
 * used only to spot several accounts being run from one device — lib/account-trust.ts. It carries
 * nothing about the device itself. Kept free of server-only imports so the proxy can use it.
 */
export const DEVICE_COOKIE = "mxi_device";
/** Browsers cap cookie lifetimes at 400 days. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidDeviceId(value: string | undefined | null): value is string {
  return !!value && UUID_PATTERN.test(value);
}
