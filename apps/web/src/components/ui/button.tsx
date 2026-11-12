import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

// 10px-radius buttons, as on the landing, with a mechanical press (scale on :active) — cheap, interruptible, no JS.
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium outline-none transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-snappy active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:opacity-90",
        accent: "bg-primary text-primary-foreground hover:opacity-90",
        soft: "bg-primary-soft text-primary hover:bg-primary/15",
        secondary: "bg-fill text-foreground hover:bg-fill-strong",
        outline: "border border-dashed border-input bg-transparent text-foreground hover:bg-hover",
        ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
        danger: "bg-danger-soft text-danger hover:bg-danger/20",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-[13px]",
        xs: "h-7 px-2.5 text-xs",
        lg: "h-12 px-6 text-[17px]",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-xs": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...(asChild ? {} : { type: props.type ?? "button" })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
