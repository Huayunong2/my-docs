import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: "top" | "right" | "bottom" | "left";
  }
>(({ side = "bottom", className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-overlay fixed inset-0 z-[70] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "ui-modal-surface fixed z-[71] flex flex-col outline-hidden",
        side === "bottom" && "inset-x-0 bottom-0 max-h-[min(88dvh,720px)] rounded-t-2xl border-t data-[state=open]:animate-slide-up",
        side === "top" && "inset-x-0 top-0 max-h-[88dvh] rounded-b-2xl border-b data-[state=open]:animate-slide-up",
        side === "left" && "inset-y-0 left-0 h-full w-[min(90vw,420px)] rounded-r-2xl border-r data-[state=open]:animate-slide-up",
        side === "right" && "inset-y-0 right-0 h-full w-[min(90vw,420px)] rounded-l-2xl border-l data-[state=open]:animate-slide-up",
        className,
      )}
      {...props}
    >
      {side === "bottom" && <div className="ui-sheet-grabber mx-auto mt-2 h-1 w-10 shrink-0 rounded-full" aria-hidden="true" />}
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex shrink-0 flex-col gap-1.5 px-4 pb-3 pt-4 sm:px-5", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold text-[var(--ui-text)]", className)} {...props} />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-xs leading-5 text-[var(--ui-text-muted)]", className)} {...props} />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
