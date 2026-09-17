"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { BottomSheet, BottomSheetContent, BottomSheetTitle, BottomSheetDescription } from "@/components/ui/bottom-sheet";
import type { VariantProps } from "class-variance-authority";

export function LogoutButton({
  className,
  variant = "outline",
  size = "default",
}: { className?: string } & VariantProps<typeof buttonVariants>) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function logout() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        Log out
      </Button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <div className="flex flex-col gap-4 px-5 pb-6">
            <div>
              <BottomSheetTitle>Log out?</BottomSheetTitle>
              <BottomSheetDescription>You&apos;ll need to log back in to keep predicting.</BottomSheetDescription>
            </div>
            <div className="flex gap-2.5">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={logout} disabled={loading}>
                {loading ? "Logging out..." : "Log out"}
              </Button>
            </div>
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
