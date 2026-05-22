export interface BinaryLatch {
	wait(): Promise<void>;
	signal(): void;
}

type BinaryLatchState =
	| { type: "empty" }
	| { type: "waiting"; promise: Promise<void>; resolve: () => void }
	| { type: "signaled" };

/**
 * Binary latch. All concurrent `wait()` calls share the same pending promise
 * and wake together when `signal()` fires. A signal sent before any waiter is
 * buffered so the next `wait()` returns immediately; subsequent waiters block
 * again until the next signal.
 */
export function createBinaryLatch(): BinaryLatch {
	let state: BinaryLatchState = { type: "empty" };

	return {
		wait(): Promise<void> {
			switch (state.type) {
				case "signaled":
					state = { type: "empty" };
					return Promise.resolve();
				case "waiting":
					return state.promise;
				case "empty": {
					let resolve: () => void = () => {};
					const promise = new Promise<void>((r) => {
						resolve = r;
					});
					state = { type: "waiting", promise, resolve };
					return promise;
				}
				default:
					return state satisfies never;
			}
		},
		signal(): void {
			switch (state.type) {
				case "waiting": {
					const { resolve } = state;
					state = { type: "empty" };
					resolve();
					return;
				}
				case "empty":
				case "signaled":
					state = { type: "signaled" };
					return;
				default:
					state satisfies never;
			}
		},
	};
}
