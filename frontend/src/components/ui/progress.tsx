import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

interface ProgressProps {
  value: number;
  className?: string;
  "aria-label"?: string;
}

export function Progress({ value, className, ...aria }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <ProgressPrimitive.Root
      value={clamped}
      max={100}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...aria}
    >
      <ProgressPrimitive.Indicator
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${clamped}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
