import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "font-sans text-xs font-medium tracking-tight",
    "rounded-md border transition-[background,color,box-shadow,border-color,transform] duration-150 ease-out",
    "disabled:opacity-40 disabled:pointer-events-none",
    "focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)] focus-visible:outline-offset-2",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        solid: [
          "text-[var(--color-ink)]",
          "bg-[color-mix(in_oklch,var(--color-violet)_20%,transparent)]",
          "border-[var(--color-glass-edge-hot)]",
          "hover:bg-[color-mix(in_oklch,var(--color-violet)_32%,transparent)]",
          "hover:border-[var(--color-violet-hot)]",
          "hover:shadow-[var(--shadow-glow-violet)]",
        ].join(" "),
        glass: [
          "text-[var(--color-ink)]",
          "bg-[var(--color-glass)] backdrop-blur-xl",
          "border-[var(--color-glass-edge)]",
          "hover:bg-[var(--color-glass-hi)]",
          "hover:border-[var(--color-glass-edge-hot)]",
        ].join(" "),
        ghost: [
          "text-[var(--color-ink-dim)]",
          "bg-transparent border-transparent",
          "hover:bg-[var(--color-glass)]",
          "hover:text-[var(--color-ink)]",
        ].join(" "),
        chip: [
          "text-[var(--color-ink-dim)]",
          "bg-[var(--color-glass)] border-[var(--color-glass-edge)]",
          "hover:text-[var(--color-ink)] hover:border-[var(--color-glass-edge-hot)]",
        ].join(" "),
      },
      size: {
        xs: "h-6 px-2 text-[11px]",
        sm: "h-7 px-2.5",
        md: "h-8 px-3",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: { variant: "glass", size: "sm" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, asChild, ...props }, ref) {
    const Comp = asChild === true ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
