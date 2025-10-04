import type { EventSourceOptions, EventSourceWrapper, EventTypeMap } from "./api.ts";

interface NodeEventSourceInit {
	withCredentials?: boolean;
	headers?: Record<string, string>;
	proxy?: string;
	https?: unknown;
	rejectUnauthorized?: boolean;
}

interface NodeEventSource {
	readonly readyState: 0 | 1 | 2;
	readonly url: string;
	readonly withCredentials: boolean;

	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: Event) => void) | null;

	close(): void;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
}

interface NodeEventSourceConstructor {
	new (url: string, eventSourceInitDict?: NodeEventSourceInit): NodeEventSource;
}

/**
 * Node.js-specific EventSource wrapper implementation
 * Uses the 'eventsource' npm package for Node.js compatibility
 */
class NodeEventSourceWrapper implements EventSourceWrapper {
	private readonly eventSource: NodeEventSource;

	constructor(url: string, options?: EventSourceOptions) {
		// Lazy evaluation - only check for EventSource when actually creating an instance
		// This prevents crashes on module load in Node.js environments
		if (!globalThis.EventSource) {
			throw new Error("EventSource not available. Install 'eventsource' package for Node.js support.");
		}

		// Type-safe creation with runtime validation
		const EventSourceConstructor = globalThis.EventSource as unknown as NodeEventSourceConstructor;
		if (typeof EventSourceConstructor !== "function") {
			throw new Error("EventSource is not a constructor function");
		}

		this.eventSource = new EventSourceConstructor(url, {
			withCredentials: options?.withCredentials,
		});
	}

	get readyState(): 0 | 1 | 2 {
		return this.eventSource.readyState;
	}

	get url(): string {
		return this.eventSource.url;
	}

	get withCredentials(): boolean {
		return this.eventSource.withCredentials;
	}

	close(): void {
		this.eventSource.close();
	}

	addEventListener<K extends keyof EventTypeMap>(
		type: K,
		listener: (event: EventTypeMap[K]) => void,
		_options?: boolean | AddEventListenerOptions,
	): void {
		this.eventSource.addEventListener(type, listener as EventListener);
	}

	removeEventListener<K extends keyof EventTypeMap>(
		type: K,
		listener: (event: EventTypeMap[K]) => void,
		_options?: boolean | EventListenerOptions,
	): void {
		this.eventSource.removeEventListener(type, listener as EventListener);
	}

	get onopen(): ((event: Event) => void) | null {
		return this.eventSource.onopen;
	}

	set onopen(handler: ((event: Event) => void) | null) {
		this.eventSource.onopen = handler;
	}

	get onmessage(): ((event: MessageEvent) => void) | null {
		return this.eventSource.onmessage;
	}

	set onmessage(handler: ((event: MessageEvent) => void) | null) {
		this.eventSource.onmessage = handler;
	}

	get onerror(): ((event: Event) => void) | null {
		return this.eventSource.onerror;
	}

	set onerror(handler: ((event: Event) => void) | null) {
		this.eventSource.onerror = handler;
	}
}

export function createEventSource(url: string, options?: EventSourceOptions): EventSourceWrapper {
	return new NodeEventSourceWrapper(url, options);
}
