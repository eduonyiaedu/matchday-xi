"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * In-page share preview — fetches the generated card image and shows it as an overlay on the
 * same screen (rather than navigating to the raw image), with a native-share button (device share
 * sheet — WhatsApp, Instagram, Messages, etc., whatever the OS offers) and a save-to-device
 * fallback. Tapping anywhere outside the card dismisses it. Always requests the "story" format —
 * the fuller composition with the actual lineup, best suited to how a share sheet is typically
 * used (sending to a person or a story-style destination) — the square format still exists for
 * platforms that fetch the image directly (e.g. a link preview), just isn't what this overlay shows.
 */
export function ShareOverlay({ predictionId, onClose }: { predictionId: string; onClose: () => void }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    fetch(`/api/share/${predictionId}?format=story`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load share card");
        return res.blob();
      })
      .then((b) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setImgUrl(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [predictionId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function";

  async function handleShare() {
    if (!blob) return;
    const file = new File([blob], "matchday-xi.png", { type: "image/png" });
    if (canNativeShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Matchday XI" });
      } catch {
        // User cancelled the share sheet — not an error.
      }
    }
  }

  function handleSave() {
    if (!imgUrl) return;
    const a = document.createElement("a");
    a.href = imgUrl;
    a.download = "matchday-xi.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-5 bg-black/80 p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[70vh] items-center justify-center">
        {loading && <p className="text-sm text-chalk">Preparing your card...</p>}
        {error && <p className="text-sm text-destructive">Couldn&apos;t load the share card.</p>}
        {imgUrl && !error && (
          <img
            src={imgUrl}
            alt="Your Matchday XI share card"
            className="max-h-[70vh] rounded-[14px] shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {canNativeShare && (
          <Button size="lg" disabled={!blob} onClick={handleShare}>
            Share
          </Button>
        )}
        <Button size="lg" variant="outline" disabled={!imgUrl} onClick={handleSave}>
          Save image
        </Button>
      </div>
      <button type="button" onClick={onClose} className="text-sm text-muted-foreground">
        Close
      </button>
    </div>
  );
}
