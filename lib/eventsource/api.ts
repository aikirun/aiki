// todo: use string instead of number
export type EventSourceReadyState = 0 | 1 | 2;

export interface EventTypeMap {
	error: Event;
	message: MessageEvent;
	open: Event;
}

export interface EventSourceWrapper {
	/**
	 * The current state of the connection
	 */
	readonly readyState: EventSourceReadyState;

	/**
	 * The URL of the EventSource
	 */
	readonly url: string;

	/**
	 * Whether to include credentials in cross-origin requests
	 */
	readonly withCredentials: boolean;

	/**
	 * Closes the connection
	 */
	close(): void;

	/**
	 * Adds an event listener for the specified event type
	 */
	addEventListener<K extends keyof EventTypeMap>(
		type: K,
		listener: (event: EventTypeMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;

	/**
	 * Removes an event listener for the specified event type
	 */
	removeEventListener<K extends keyof EventTypeMap>(
		type: K,
		listener: (event: EventTypeMap[K]) => void,
		options?: boolean | EventListenerOptions,
	): void;

	/**
	 * Event handler for when the connection is opened
	 */
	onopen: ((event: Event) => void) | null;

	/**
	 * Event handler for when a message is received
	 */
	onmessage: ((event: MessageEvent) => void) | null;

	/**
	 * Event handler for when an error occurs
	 */
	onerror: ((event: Event) => void) | null;
}

export interface EventSourceOptions {
	withCredentials?: boolean;
}
