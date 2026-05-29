import type { CreatePublisher, CreateSubscriber } from "@aikirun/types/infra/queue";

import { createInMemoryPublisher } from "./publisher";
import { createStore } from "./store";
import { createInMemorySubscriber } from "./subscriber";

export interface InMemoryQueue {
	publisher: CreatePublisher;
	subscriber: CreateSubscriber;
}

/**
 * In-process publisher + subscriber sharing a single store. The store
 * holds workflow-run queues and a registry of subscribers parked on the queues.
 */
export function inMemoryQueue(): InMemoryQueue {
	const store = createStore();
	return {
		publisher: createInMemoryPublisher(store),
		subscriber: createInMemorySubscriber(store),
	};
}
