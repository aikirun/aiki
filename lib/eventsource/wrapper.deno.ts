import type { EventSourceOptions, EventSourceWrapper, EventTypeMap } from "./api.ts";

class DenoEventSourceWrapper implements EventSourceWrapper {
	private readonly eventSource: EventSource;

	constructor(url: string, options?: EventSourceOptions) {
		this.eventSource = new EventSource(url, options);
	}

	get readyState(): 0 | 1 | 2 {
		return this.eventSource.readyState as 0 | 1 | 2;
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
		options?: boolean | AddEventListenerOptions,
	): void {
		this.eventSource.addEventListener(type, listener, options);
	}

	removeEventListener<K extends keyof EventTypeMap>(
		type: K,
		listener: (event: EventTypeMap[K]) => void,
		options?: boolean | EventListenerOptions,
	): void {
		this.eventSource.removeEventListener(type, listener, options);
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
	return new DenoEventSourceWrapper(url, options);
}
