'use client';

import { useEffect, useRef } from 'react';
import gsap from "gsap";

export function AppLaunchLoading() {
	const containerRef = useRef<HTMLDivElement>(null);
	const textRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const ctx = gsap.context(() => {
			// Split text into characters for animation
			const text = "WoopMemo more light";
			if (textRef.current) {
				textRef.current.innerHTML = text
					.split("")
					.map((char) => (char === " " ? "&nbsp;" : char))
					.map((char, /*i*/) => `<span class="char" style="opacity:0; display:inline-block">${char}</span>`)
					.join("");

				gsap.to(".char", {
					opacity: 1,
					y: 0,
					duration: 0.5,
					stagger: 0.05,
					ease: "power2.out",
					delay: 0.2,
				});
			}

			// Subtle floating animation
			gsap.to(containerRef.current, {
				scale: 1.02,
				duration: 2,
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
		}, containerRef);

		return () => ctx.revert();
	}, []);

	return (
		<div
			ref={containerRef}
			className="fixed inset-0 flex items-center justify-center bg-transparent z-[9999]"
		>
			<span
				ref={textRef}
				className="text-[2.25rem] font-medium text-[var(--muted-foreground)] tracking-wider"
				style={{
					fontFamily: "system-ui, -apple-system, sans-serif",
					letterSpacing: "0.15em",
				}}
			/>
		</div>
	);
}