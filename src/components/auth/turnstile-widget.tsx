"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * The live site's Cloudflare Turnstile site key ("Matchday XI" widget). Public by design — it's
 * sent to every browser that loads the form — so it lives here rather than needing a dashboard
 * setting. The widget only accepts the hostnames below (set on the Cloudflare side too), so it's
 * only used there: localhost and preview deployments get no CAPTCHA. NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * overrides it everywhere if set. The matching secret key lives only in Supabase (Authentication →
 * Attack Protection), which verifies each token on sign-up and email sign-in.
 */
const PRODUCTION_SITE_KEY = "0x4AAAAAAFBgaRa33CaB4Q3b";
const PRODUCTION_HOSTNAMES = ["matchday-xi-psi.vercel.app", "matchday-xi-eduonyiaedu-7577.vercel.app"];

function resolveSiteKey(): string {
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return PRODUCTION_HOSTNAMES.includes(window.location.hostname) ? PRODUCTION_SITE_KEY : "";
}

const noSubscription = () => () => {};

/** The site key for this page, or "" (no CAPTCHA). Empty during server rendering and hydration. */
export function useTurnstileSiteKey(): string {
  return useSyncExternalStore(noSubscription, resolveSiteKey, () => "");
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load the CAPTCHA"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Cloudflare Turnstile — a mostly invisible bot check (Supabase Auth verifies the token on
 * sign-up and email sign-in once CAPTCHA protection is switched on in its dashboard). Each token
 * works once: remount this (change its `key`) after every attempt to get a fresh one.
 */
export function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);

  // `onToken` should be stable (e.g. a useState setter) — a new one re-creates the widget.
  useEffect(() => {
    if (!siteKey) return;
    let widgetId: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={container} className="min-h-[65px]" />;
}
