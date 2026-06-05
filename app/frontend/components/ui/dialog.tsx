'use client';

import { createContext, useContext, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface DialogContextType {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const DialogContext = createContext<DialogContextType | null>(null);

function useDialogContext() {
	const context = useContext(DialogContext);
	if (!context) {
		throw new Error('Dialog components must be used within a Dialog');
	}
	return context;
}

interface DialogProps {
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

export function Dialog({ children, open, onOpenChange }: DialogProps) {
	return (
		<DialogContext.Provider value={open !== undefined && onOpenChange ? { open, onOpenChange } : null}>
			{children}
		</DialogContext.Provider>
	);
}

interface DialogTriggerProps {
	children: ReactNode;
	asChild?: boolean;
}

export function DialogTrigger({ children }: DialogTriggerProps) {
	return <>{children}</>;
}

interface DialogContentProps {
	children: ReactNode;
	className?: string;
	fullScreen?: boolean;
	showOverlay?: boolean;
}

export function DialogContent({ children, className, showOverlay = true }: DialogContentProps) {
	const context = useDialogContext();
	const open = context?.open ?? false;
	const onOpenChange = context?.onOpenChange ?? (() => {});

	if (!open) return null;

	return createPortal(
		<>
			{showOverlay && (
				<div
					className="fixed inset-0 bg-black/50 z-50 transition-opacity duration-200 ease-out"
					onClick={() => onOpenChange(false)}
				/>
			)}
			<div
				className={cn(
					'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[380px] rounded-xl bg-[var(--background)] p-6 shadow-lg transition-all duration-200 ease-out animate-in fade-in zoom-in-95',
					className
				)}
			>
				<button
					onClick={() => onOpenChange(false)}
					className="absolute top-4 right-4 p-1 rounded-md hover:bg-[var(--muted)]"
				>
					<X className="w-5 h-5" />
				</button>
				{children}
			</div>
		</>,
		document.body
	);
}

interface DialogCloseProps {
	children?: ReactNode;
}

export function DialogClose({ children }: DialogCloseProps) {
	const context = useDialogContext();
	return (
		<button
			onClick={() => context?.onOpenChange(false)}
			className="absolute top-4 right-4 p-1 rounded-md hover:bg-[var(--muted)]"
		>
			{children || <X className="w-5 h-5" />}
		</button>
	);
}

export function DialogHeader({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div className={cn('mb-3', className)}>
			{children}
		</div>
	);
}

export function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<h2 className={cn('text-base text-[var(--foreground)]', className)}>
			{children}
		</h2>
	);
}

export function DialogDescription({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<p className={cn('text-sm text-[var(--muted-foreground)] mt-1', className)}>
			{children}
		</p>
	);
}