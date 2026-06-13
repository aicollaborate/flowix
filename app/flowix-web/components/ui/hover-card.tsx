import * as React from "react";
import { cn } from "../../lib/utils";

// Context for managing hover card state
interface HoverCardContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: { current: HTMLDivElement | null };
}

const HoverCardContext = React.createContext<HoverCardContextValue | null>(null);

function useHoverCardContext() {
	const context = React.useContext(HoverCardContext);
	if (!context) {
		throw new Error("HoverCard components must be used within HoverCard");
	}
	return context;
}

interface HoverCardProps {
	children: React.ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

function HoverCard({ children, open: controlledOpen, onOpenChange }: HoverCardProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
	const triggerRef = React.useRef<HTMLDivElement>(null);
	const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
	const setOpen = React.useCallback(
		(newOpen: boolean) => {
			if (controlledOpen === undefined) {
				setUncontrolledOpen(newOpen);
			}
			onOpenChange?.(newOpen);
		},
		[controlledOpen, onOpenChange]
	);

	return (
		<HoverCardContext.Provider value={{ open, setOpen, triggerRef }}>
			<div className="relative">{children}</div>
		</HoverCardContext.Provider>
	);
}

interface HoverCardTriggerProps {
	children?: React.ReactNode;
	asChild?: boolean;
	className?: string;
	delay?: number;
	closeDelay?: number;
	render?: React.ReactNode;
}

function HoverCardTrigger({
	children,
	asChild,
	className,
	delay = 400,
	closeDelay = 300,
	render,
}: HoverCardTriggerProps) {
	const { open, setOpen, triggerRef } = useHoverCardContext();
	const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
	const closeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
	const localTriggerRef = React.useRef<HTMLDivElement>(null);

	// Sync localTriggerRef to context triggerRef
	React.useEffect(() => {
		triggerRef.current = localTriggerRef.current;
	}, [triggerRef]);

	const handleMouseEnter = (_e: React.MouseEvent) => {
		if (closeTimeoutRef.current) {
			clearTimeout(closeTimeoutRef.current);
		}
		timeoutRef.current = setTimeout(() => {
			setOpen(true);
		}, delay);
	};

	const handleMouseLeave = (_e: React.MouseEvent) => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}
		closeTimeoutRef.current = setTimeout(() => {
			setOpen(false);
		}, closeDelay);
	};

	// Support render prop pattern like shadcn
	if (render) {
		const renderElement = render as React.ReactElement;

		return (
			<div
				ref={localTriggerRef}
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
				style={{ display: 'inline-block', cursor: 'pointer' }}
				data-state={open ? "open" : "closed"}
			>
				{renderElement}
			</div>
		);
	}

	if (asChild && React.Children.count(children) === 1) {
		const child = React.Children.only(children) as React.ReactElement<any>;
		return React.cloneElement(child, {
			ref: (el: HTMLDivElement | null) => {
				triggerRef.current = el;
			},
			onMouseEnter: handleMouseEnter,
			onMouseLeave: handleMouseLeave,
			"data-state": open ? "open" : "closed",
		});
	}

	return (
		<div
			ref={triggerRef as React.LegacyRef<HTMLDivElement>}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			className={cn("cursor-pointer", className)}
			data-state={open ? "open" : "closed"}
		>
			{children}
		</div>
	);
}

interface HoverCardContentProps {
	children: React.ReactNode;
	align?: "start" | "center" | "end";
	sideOffset?: number;
	className?: string;
}

function HoverCardContent({
	children,
	align = "end",
	sideOffset = 4,
	className,
}: HoverCardContentProps) {
	const { open, setOpen, triggerRef } = useHoverCardContext();
	const contentRef = React.useRef<HTMLDivElement>(null);
	const [position, setPosition] = React.useState({ top: 0, left: 0 });

	// Calculate position when opened
	React.useEffect(() => {
		if (!open || !triggerRef.current) return;

		const updatePosition = () => {
			const rect = triggerRef.current!.getBoundingClientRect();
			setPosition({
				top: rect.bottom + sideOffset,
				left: rect.right,
			});
		};

		updatePosition();

		// Also update on scroll/resize
		window.addEventListener('scroll', updatePosition, true);
		window.addEventListener('resize', updatePosition);

		return () => {
			window.removeEventListener('scroll', updatePosition, true);
			window.removeEventListener('resize', updatePosition);
		};
	}, [open, sideOffset]);

	// Close on click outside
	React.useEffect(() => {
		if (!open) return;

		const handleClickOutside = (e: MouseEvent) => {
			if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [open, setOpen]);

	if (!open) return null;

	// Adjust left position: align="end" means right-aligned with trigger's right edge
	const leftPos = align === "center"
		? position.left - 160
		: align === "end"
			? position.left - 200
			: position.left;

	return (
		<div
			ref={contentRef}
			className={cn(
				"fixed z-[100] w-[200px] overflow-y-auto bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg p-3 animate-in fade-in-0 zoom-in-95",
				className
			)}
			style={{
				top: position.top,
				left: Math.max(4, leftPos),
			}}
			onClick={(e) => e.stopPropagation()}
		>
			{children}
		</div>
	);
}

export { HoverCard, HoverCardTrigger, HoverCardContent };