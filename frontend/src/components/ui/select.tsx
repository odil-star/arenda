import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
}

interface SelectProps<V extends string> {
  id?: string;
  value: V | "";
  onValueChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  placeholder?: string;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  onBlur?: () => void;
}

function SelectInner<V extends string>(
  { id, value, onValueChange, options, placeholder, className, onBlur, ...aria }: SelectProps<V>,
  ref: React.ForwardedRef<HTMLButtonElement>,
) {
  const [open, setOpen] = useState(false);

  // Тап вне меню: Radix закрывает его на pointerdown, и следующий click
  // попадает на кнопку под пальцем — меню открывается снова.
  // Поэтому закрываем только после click и гасим его.
  const handlePointerDownOutside = (e: Event) => {
    e.preventDefault();
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
      setOpen(false);
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => {
      window.removeEventListener("click", swallow, { capture: true });
      setOpen(false);
    }, 600);
  };

  return (
    <SelectPrimitive.Root open={open} onOpenChange={setOpen} value={value || undefined} onValueChange={(v) => onValueChange(v as V)}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        onBlur={onBlur}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-base sm:h-10 sm:text-[15px]",
          "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring data-[placeholder]:text-muted-foreground aria-[invalid=true]:border-danger",
          className,
        )}
        {...aria}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={12}
          onPointerDownOutside={handlePointerDownOutside}
          className="z-[60] max-h-[min(var(--radix-select-content-available-height),22rem)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in"
        >
          <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto overscroll-contain">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex min-h-11 cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 text-base outline-none data-[highlighted]:bg-muted sm:min-h-9 sm:text-sm"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-4 text-primary" aria-hidden />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export const Select = forwardRef(SelectInner) as <V extends string>(
  props: SelectProps<V> & { ref?: React.ForwardedRef<HTMLButtonElement> },
) => ReturnType<typeof SelectInner>;
