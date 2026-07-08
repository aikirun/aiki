import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Measures an element's own width via ResizeObserver, so responsive decisions can be based on the
 * actual rendered width rather than the viewport (which is a poor proxy when a sidebar eats space).
 * Starts at Infinity so content shows until the first measurement lands.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(Number.POSITIVE_INFINITY);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setWidth(entry.contentRect.width);
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return [ref, width];
}
