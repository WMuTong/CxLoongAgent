import { cn } from "@/lib/utils";
import * as React from "react";

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Alert.displayName = "Alert";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-destructive", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription };
