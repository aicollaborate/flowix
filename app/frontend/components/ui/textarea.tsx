import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<
	HTMLTextAreaElement,
	React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
	return (
		<textarea
			data-slot="textarea"
			ref={ref}
			className={cn(
				"flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50",
				className
			)}
			{...props}
		/>
	);
});
Textarea.displayName = "Textarea";

const AITextarea = React.forwardRef<
	HTMLTextAreaElement,
	React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
	return (
		<textarea
			data-slot="textarea"
			ref={ref}
			className={cn(
				"flex field-sizing-content min-h-16 w-full border border-[var(--border)] bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--primary)] disabled:cursor-not-allowed disabled:bg-[var(--border)]/50 disabled:opacity-50 aria-invalid:border-[var(--destructive)]",
				className
			)}
			{...props}
		/>
	);
});
AITextarea.displayName = "AITextarea";

export { Textarea, AITextarea };