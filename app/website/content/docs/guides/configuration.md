---
title: Runtime Configuration
description: Tune the server, workers, and endpoints at construction — or live, from your own config source, without redeploying.
---

The server runtime, workers, and endpoints each expose runtime tunables — concurrency, polling cadence, timeouts. Every setting has a default, and all three components accept configuration the same way: a `config` parameter that takes either a plain overrides object or a config provider.

The full set of settings for each component is its config type — `ServerRuntimeConfig` in `@aikirun/server`, `WorkerConfig` in `@aikirun/worker`, `EndpointConfig` in `@aikirun/endpoint`. Explore them in your editor; they are plain typed objects.

## Static Configuration

Pass an overrides object. It is deep-merged onto the defaults once, so a partial override keeps every untouched setting at its default:

```typescript
import { worker } from "@aikirun/worker";

const aikiWorker = worker({
	workflows: [orderWorkflowV1],
	config: { maxConcurrentWorkflowRuns: 10 },
});
```

The server's runtime settings sit under `runtime`:

```typescript
import { database, server } from "@aikirun/server";

const aikiServer = server({
	db: database({ provider: "pg", url: databaseUrl }),
	runtime: {
		config: { gracefulShutdownTimeoutMs: 10_000 },
	},
});
```

Endpoints take the same shape: `endpoint({ ..., config: { signatureMaxAgeMs: 60_000 } })`.

## Dynamic Configuration

Pass a provider instead of an object, and the component reads its settings live. A config provider is two members:

```typescript
interface ConfigProvider<Config> {
	// The latest snapshot, read synchronously.
	readonly config: Config;
	// A live view of one branch of the config tree.
	scope<Key extends keyof Config>(key: Key): ConfigProvider<Config[Key]>;
}

// What the `config` parameter accepts: a factory the component invokes once,
// with a context from that component.
type CreateConfigProvider<Config> = (context: ConfigProviderContext) => ConfigProvider<Config>;

interface ConfigProviderContext {
	logger: Logger;
	signal: AbortSignal;
}
```

The factory runs once, when the component starts — a worker at `spawn`, the server runtime at `start`. The context's `signal` aborts when that same component shuts down (the worker handle's `stop()`, the server runtime handle's `stop()`), so register any teardown your provider needs on it. The `logger` is the component's own logger; the bundled helpers use it to report failed refreshes, and a custom provider can log through it the same way.

From then on, the component reads values where it uses them: the worker checks its concurrency limit on each claim iteration, the server's daemons read their cadence each tick, the endpoint reads per request, and workflow-execution settings are read live even by runs already in flight. A new snapshot simply takes effect at the next read.

### The interval-refresh helper

`dynamicWorkerConfigProvider` and `dynamicRuntimeConfigProvider` cover the most common provider shape — re-fetch from a source on an interval:

```typescript
import { dynamicWorkerConfigProvider, worker } from "@aikirun/worker";

const aikiWorker = worker({
	workflows: [orderWorkflowV1],
	config: dynamicWorkerConfigProvider({
		initial: { maxConcurrentWorkflowRuns: 10 },
		async refresh(current) {
			return { ...current, maxConcurrentWorkflowRuns: await configService.workerConcurrency() };
		},
		refreshIntervalMs: 30_000,
	}),
});
```

Its behavior:

- The worker starts immediately on the defaults with `initial` applied — construction never blocks on your config source being reachable.
- `refresh` receives the current config and returns the next complete config.
- A failed refresh keeps the last-good snapshot and retries with backoff; the worker keeps running throughout.
- The refresh loop stops when the worker shuts down.

### Bring Your Own Provider

The helper is one implementation of the contract, not the contract itself. Anything that satisfies `ConfigProvider` works — for example a push-based provider that applies changes the moment your config source announces them, instead of on a polling interval. Each package exports the contract and context types, `asConfigProvider` — which wraps a read function into the contract, `scope` included — and its defaults (`defaultWorkerConfig`, `defaultServerRuntimeConfig`, `defaultEndpointConfig`):

```typescript
import { asConfigProvider, defaultWorkerConfig, worker } from "@aikirun/worker";

const aikiWorker = worker({
	workflows: [orderWorkflowV1],
	config: ({ signal }) => {
		// A provider supplies the complete config tree; start from the defaults.
		let current = { ...defaultWorkerConfig, maxConcurrentWorkflowRuns: 10 };

		const unsubscribe = configService.subscribe((next) => {
			current = { ...current, ...next };
		});
		signal.addEventListener("abort", unsubscribe);

		return asConfigProvider(() => current);
	},
});
```

Both members read through to your closure, so the scoped views taken internally stay live too.

## Endpoints Are Passive

A worker and the server are running processes with a shutdown, so their factory context carries an abort signal for teardown. An endpoint is just a request handler you mount — it owns no lifecycle and has no signal to give. Its factory therefore receives a context without the signal, and the interval-refresh helpers, which need one to stop their loop, deliberately do not fit.

Configure endpoints with a static overrides object, or bring a provider whose lifecycle your application owns — for example one that re-reads on each access, or one whose refresh loop you start and stop alongside your HTTP server.

## Next Steps

- **[Workers](/docs/core-concepts/workers)** - How workers claim and execute runs
- **[Server](/docs/architecture/server)** - The runtime's daemons and what they poll
- **[Reliable Hooks](/docs/guides/reliable-hooks)** - Durable follow-up actions on workflow completion
