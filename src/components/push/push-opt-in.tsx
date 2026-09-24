"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "mdxi-push-opt-in-dismissed";

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer as ArrayBuffer;
}

/** Dismissible home-page card offering push notifications — fixture open, lock warnings, scoring. */
export function PushOptIn() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function check() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
      if (Notification.permission === "denied") return;
      if (localStorage.getItem(DISMISSED_KEY)) return;
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        // Already subscribed on this device: quietly re-save it (the server upserts), so a device
        // the server dropped — e.g. after repeated delivery failures — re-registers on its own
        // instead of silently never getting notifications again.
        if (Notification.permission === "granted") {
          fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(existing.toJSON()),
          }).catch(() => {});
        }
        return;
      }
      setVisible(true);
    }
    check().catch(() => {});
  }, []);

  async function enable() {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setVisible(false);
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Push isn't configured yet");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error("Couldn't save your subscription");
      setVisible(false);
    } catch {
      // Browser-level subscribe (or the save to our server) failed — leave the card up so the
      // user can retry, rather than silently dismissing it and looking "on" when it isn't.
      toast.error("Couldn't turn on notifications. Try again?");
    } finally {
      setLoading(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div>
          <p className="font-heading text-[15px] font-semibold uppercase">Turn on notifications</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Know when predictions open, when a lock is 30 minutes out, and when scoring lands.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={dismiss} disabled={loading}>
            Not now
          </Button>
          <Button size="sm" onClick={enable} disabled={loading}>
            {loading ? "Enabling..." : "Enable"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
