import type { CreatePublisher, CreateSubscriber } from "@aikirun/types/infra/queue";

import { createBroker } from "./broker";
import { createInMemoryPublisher } from "./publisher";
import { createInMemorySubscriber } from "./subscriber";

export interface InMemoryQueue {
	publisher: CreatePublisher;
	subscriber: CreateSubscriber;
	clear(): void;
}

/**
 * In-process publisher + subscriber sharing a single broker. The broker
 * holds workflow-run queues and a registry of subscribers parked on the queues.
 */
export function inMemoryQueue(): InMemoryQueue {
	const broker = createBroker();
	return {
		publisher: createInMemoryPublisher(broker),
		subscriber: createInMemorySubscriber(broker),
		clear: () => broker.clear(),
	};
}
