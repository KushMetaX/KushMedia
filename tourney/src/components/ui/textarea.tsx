import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full rounded-md bg-raised px-3 py-2 text-sm text-fg shadow-[var(--shadow-border)]",
        "placeholder:text-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
