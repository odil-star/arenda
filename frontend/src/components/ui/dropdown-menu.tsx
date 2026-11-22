import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Dropdown.Root;
export const DropdownMenuTrigger = Dropdown.Trigger;
export const DropdownMenuRadioGroup = Dropdown.RadioGroup;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof Dropdown.Content>,
  ComponentPropsWithoutRef<typeof Dropdown.Content>
>(({ className, sideOffset = 6, align = "end", ...props }, ref) => (
  <Dropdown.Portal>
    <Dropdown.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in",
        className,
      )}
      {...props}
    />
  </Dropdown.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

const itemClass =
  "relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 sm:min-h-9 [&_svg]:size-4 [&_svg]:text-muted-foreground";

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof Dropdown.Item>,
  ComponentPropsWithoutRef<typeof Dropdown.Item>
>(({ className, ...props }, ref) => <Dropdown.Item ref={ref} className={cn(itemClass, className)} {...props} />);
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof Dropdown.RadioItem>,
  ComponentPropsWithoutRef<typeof Dropdown.RadioItem>
>(({ className, children, ...props }, ref) => (
  <Dropdown.RadioItem ref={ref} className={cn(itemClass, "pl-8", className)} {...props}>
    <Dropdown.ItemIndicator className="absolute left-2.5 inline-flex">
      <span className="size-2 rounded-full bg-primary" />
    </Dropdown.ItemIndicator>
    {children}
  </Dropdown.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof Dropdown.Label>) {
  return <Dropdown.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-border" />;
}
