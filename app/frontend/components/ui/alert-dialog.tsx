'use client';

import { createContext, useContext, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AlertDialogContextType {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const AlertDialogContext = createContext<AlertDialogContextType | null>(null);

function useAlertDialogContext() {
	const context = useContext(AlertDialogContext);
	if (!context) {
		throw new Error('AlertDialog components must be used within an AlertDialog');
	}
	return context;
}

interface AlertDialogProps {
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

export function AlertDialog({ children, open, onOpenChange }: AlertDialogProps) {
	return (
		<AlertDialogContext.Provider value={open !== undefined && onOpenChange ? { open, onOpenChange } : null}>
			{children}
		</AlertDialogContext.Provider>
	);
}

interface AlertDialogTriggerProps {
	children: ReactNode;
	asChild?: boolean;
}

export function AlertDialogTrigger({ children }: AlertDialogTriggerProps) {
	return <>{children}</>;
}

interface AlertDialogContentProps {
	children: ReactNode;
	className?: string;
}

export function AlertDialogContent({ children, className }: AlertDialogContentProps) {
	const context = useAlertDialogContext();
	const open = context?.open ?? false;
	const onOpenChange = context?.onOpenChange ?? (() => {});

	if (!open) return null;

	return createPortal(
		<>
			<div
				className="fixed inset-0 bg-black/50 z-50 transition-opacity duration-200 ease-out"
				onClick={() => onOpenChange(false)}
			/>
			<div
				className={cn(
					'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[380px] rounded-xl bg-[var(--background)] p-6 shadow-lg transition-all duration-200 ease-out',
					'animate-in fade-in zoom-in-95',
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

export function AlertDialogHeader({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div className={cn('mb-4', className)}>
			{children}
		</div>
	);
}

export function AlertDialogTitle({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<h2 className={cn('text-base text-[var(--foreground)]', className)}>
			{children}
		</h2>
	);
}

export function AlertDialogDescription({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<p className={cn('text-sm text-[var(--muted-foreground)] mt-1', className)}>
			{children}
		</p>
	);
}

export function AlertDialogFooter({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div className={cn('flex justify-end gap-2 mt-4', className)}>
			{children}
		</div>
	);
}

interface AlertDialogActionProps {
	children: ReactNode;
	onClick?: () => void;
	className?: string;
}

export function AlertDialogAction({ children, onClick, className }: AlertDialogActionProps) {
	const context = useAlertDialogContext();
	return (
		<button
			onClick={() => {
				onClick?.();
				context?.onOpenChange(false);
			}}
			className={cn(
				'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 h-8 px-3 py-1 bg-[var(--foreground)] text-[var(--background)] hover:bg-[color-mix(in_oklch,var(--foreground)_90%,transparent)]',
				className
			)}
		>
			{children}
		</button>
	);
}

interface AlertDialogCancelProps {
	children: ReactNode;
	onClick?: () => void;
	className?: string;
}

export function AlertDialogCancel({ children, onClick, className }: AlertDialogCancelProps) {
	const context = useAlertDialogContext();
	return (
		<button
			onClick={() => {
				onClick?.();
				context?.onOpenChange(false);
			}}
			className={cn(
				'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 h-8 px-3 py-1 border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)] hover:text-[var(--secondary-foreground)]',
				className
			)}
		>
			{children}
		</button>
	);
}