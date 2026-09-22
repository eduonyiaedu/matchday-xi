"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetTitle,
  BottomSheetDescription,
} from "@/components/ui/bottom-sheet";

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function confirmDelete() {
    setLoading(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't delete your account.");
      }
      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success("Your account is scheduled for deletion in 30 days.");
      router.push("/login");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete your account.");
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <div className="flex flex-col gap-4 px-5 pb-6">
            <div>
              <BottomSheetTitle>Delete your account?</BottomSheetTitle>
              <BottomSheetDescription>
                Your account will be permanently deleted in 30 days. Until then, you can cancel
                this at any time simply by logging back in — no extra steps needed.
              </BottomSheetDescription>
            </div>
            <div>
              <label htmlFor="delete-feedback" className="text-sm text-muted-foreground">
                Why are you leaving? What could we do better? (optional)
              </label>
              <textarea
                id="delete-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                className="mt-2 w-full rounded-[9px] bg-pitch px-3 py-2.5 text-sm text-chalk shadow-[inset_0_0_0_1px_rgba(245,243,236,0.12)] outline-none"
                placeholder="Your feedback helps us improve..."
              />
            </div>
            <div className="flex gap-2.5">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={confirmDelete} disabled={loading}>
                {loading ? "Deleting..." : "Yes, delete my account"}
              </Button>
            </div>
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
