import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "z-modal fixed inset-0",
      "backdrop-blur-sm",
      "motion-safe:data-[state=open]:animate-fade-in",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
    /** Raise the overlay with the content (e.g. `z-modal` when the dialog
     *  opens above a floating window at z 2000+) — mirrors AlertDialog. */
    overlayClassName?: string;
  }
>(({ className, children, hideClose, overlayClassName, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        "max-h-[85vh] w-full max-w-[540px] overflow-y-auto",
        "glass-dense",
        "p-3",
        "motion-safe:data-[state=open]:animate-scale-in",
        "focus:outline-none",
        className
      )}
      {...props}
    >
      <DialogPrimitive.Description className="sr-only" />
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-2 top-2",
            "rounded-chip p-0.5",
            "text-text-3 hover:text-text",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          )}
          aria-label="Close"
        >
          <X className="h-[18px] w-[18px]" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-0.5 pb-2", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex justify-end gap-1 border-t border-border pt-2",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-mohave text-heading text-text", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("font-mohave text-body-sm text-text-2", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
