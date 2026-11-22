import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg border border-input bg-card px-3 text-base text-foreground sm:text-[15px] placeholder:text-muted-foreground/80 transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, "h-11 sm:h-10", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(fieldBase, "min-h-20 py-2.5", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";
