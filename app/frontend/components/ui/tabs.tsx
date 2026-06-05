import * as React from "react"

import { cn } from "../../lib/utils"

const Tabs = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & {
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
  }
>(({ className, value, defaultValue, onValueChange, children, ...props }, ref) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue || "")
  const activeValue = value !== undefined ? value : internalValue

  const handleValueChange = (newValue: string) => {
    setInternalValue(newValue)
    onValueChange?.(newValue)
  }

  return (
    <div
      ref={ref}
      data-state={activeValue ? "active" : "inactive"}
      data-value={activeValue}
      className={cn("", className)}
      {...props}
    >
      <TabsProvider value={activeValue} onValueChange={handleValueChange}>
        {children}
      </TabsProvider>
    </div>
  )
})
Tabs.displayName = "Tabs"

const TabsContext = React.createContext<{
  value: string
  onValueChange: (value: string) => void
}>({
  value: "",
  onValueChange: () => {},
})

const TabsProvider: React.FC<{
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
}> = ({ value, onValueChange, children }) => {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      {children}
    </TabsContext.Provider>
  )
}

const TabsList = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="tablist"
    className={cn(
      "inline-flex items-center justify-center rounded-md bg-muted p-0.5 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = "TabsList"

const TabsTrigger = React.forwardRef<
  React.ElementRef<"button">,
  React.ComponentPropsWithoutRef<"button"> & {
    value: string
  }
>(({ className, value, ...props }, ref) => {
  const { value: activeValue, onValueChange } = React.useContext(TabsContext)
  const isActive = activeValue === value

  return (
    <button
      ref={ref}
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      onClick={() => onValueChange(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isActive
          ? "bg-white text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    />
  )
})
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & {
    value: string
  }
>(({ className, value, ...props }, ref) => {
  const { value: activeValue } = React.useContext(TabsContext)
  const isActive = activeValue === value

  if (!isActive) return null

  return (
    <div
      ref={ref}
      role="tabpanel"
      data-state={isActive ? "active" : "inactive"}
      tabIndex={0}
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  )
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }