import * as React from "react"
import { cn } from "../../lib/utils"

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
}

const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 select-none items-center rounded border border-[rgba(0,0,0,0.06)] bg-transparent px-1.5 font-sans text-[10px] font-medium text-[#9ca3af]",
          className
        )}
        {...props}
      >
        {children}
      </kbd>
    )
  }
)
Kbd.displayName = "Kbd"

export { Kbd }