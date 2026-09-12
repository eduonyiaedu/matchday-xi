"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

// No shadcn Sheet component exists in this repo — built directly on the same Dialog primitive
// used by ui/dialog.tsx (the standard approach shadcn's own Sheet takes), just repositioned to
// slide up from the bottom instead of appearing centered.

function BottomSheet({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="bottom-sheet" {...props} />
}

function BottomSheetTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="bottom-sheet-trigger" {...props} />
}

function BottomSheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="bottom-sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/55 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function BottomSheetContent({
  className,
  heightClassName = "h-auto max-h-[85vh]",
  overlayClassName,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** e.g. "h-[62vh]" for the squad drawer. Defaults to auto-height, capped at 85vh. */
  heightClassName?: string
  /** e.g. "md:hidden" when the content itself is breakpoint-gated — the overlay must match or it
   * keeps intercepting clicks on whatever's visible underneath at the breakpoint it's hidden at. */
  overlayClassName?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <BottomSheetOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="bottom-sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex w-full flex-col rounded-t-[22px] bg-pitch-light p-0 text-chalk shadow-[0_-14px_44px_rgba(0,0,0,0.5)] outline-none duration-280 ease-[cubic-bezier(0.2,0.9,0.3,1)] data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          heightClassName,
          className
        )}
        {...props}
      >
        <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-white/20" />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function BottomSheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="bottom-sheet-title"
      className={cn("font-heading text-lg font-semibold uppercase", className)}
      {...props}
    />
  )
}

function BottomSheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="bottom-sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function BottomSheetClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="bottom-sheet-close" {...props} />
}

export {
  BottomSheet,
  BottomSheetTrigger,
  BottomSheetOverlay,
  BottomSheetContent,
  BottomSheetTitle,
  BottomSheetDescription,
  BottomSheetClose,
}
