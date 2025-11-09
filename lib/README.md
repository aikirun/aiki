# @aiki/lib

Foundation utilities library for Aiki - a durable execution engine for TypeScript.

## Installation

```bash
deno add jsr:@aiki/lib
```

## Features

- **Duration API** - Convert and validate time durations with human-readable object syntax
  - Support for days, hours, minutes, seconds, and milliseconds
  - Validation for non-negative, finite values
  - Maximum duration limits (e.g., 1 year)

- **Retry Strategies** - Flexible retry configuration for transient failures
  - Never retry
  - Fixed delay
  - Exponential backoff with optional jitter
  - Jittered exponential backoff

- **Async Utilities** - Promise and async helpers
  - Delay/sleep functionality
  - Fire-and-forget pattern with error handling

- **Polling Utilities** - Adaptive polling with backoff strategies

- **Cryptography** - Secure randomization utilities

## Quick Start

### Duration Conversion

```typescript
import { toMilliseconds } from "@aiki/lib/duration";

// Convert duration objects to milliseconds
const ms1 = toMilliseconds(5000); // 5000ms
const ms2 = toMilliseconds({ seconds: 5 }); // 5000ms
const ms3 = toMilliseconds({ minutes: 1, seconds: 30 }); // 90000ms
const ms4 = toMilliseconds({ days: 1, hours: 2 }); // 93600000ms
```

### Retry Strategies

```typescript
import type { RetryStrategy } from "@aiki/lib/retry";

const exponentialRetry: RetryStrategy = {
	type: "exponential",
	maxAttempts: 5,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	factor: 2,
};

const fixedRetry: RetryStrategy = {
	type: "fixed",
	maxAttempts: 3,
	delayMs: 1000,
};
```

### Async Utilities

```typescript
import { delay } from "@aiki/lib/async";

// Wait for a duration
await delay(1000);

// Wait with abort signal
const controller = new AbortController();
await delay(1000, { abortSignal: controller.signal });
```

## API Reference

### Duration Module

- `toMilliseconds(duration: Duration): number` - Convert Duration to milliseconds
- Type: `Duration = number | DurationObject`
- Type: `DurationObject` - Object with optional `days`, `hours`, `minutes`, `seconds`, `ms` fields

### Retry Module

Export retry strategy types and utilities for building retry logic.

### Async Module

Export async helpers like `delay()` and `fireAndForget()`.

## Documentation

For more information, see the [Aiki documentation](https://github.com/aikirun/aiki).

## License

Apache-2.0
