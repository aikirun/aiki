# Testing

Two tiers: `*.test.ts` are hermetic unit tests (`bun run test:unit`, no database);
`*.integration.test.ts` run against a live Postgres (`bun run test:integration`, credentials in
`.env.test` — see DB.md).

Before writing any test, study the exemplars for its tier and match their idioms:

- `sdk/server/src/daemons/publish-ready-runs.integration.test.ts` — minimal integration shape.
- `sdk/server/src/daemons/recover-overdue-outbox-entries.integration.test.ts` — service-path
  seeding, fake clock, assertion shapes.
- `sdk/workflow/src/run/sleeper.test.ts` — timestamps as authored data.
- `sdk/workflow/src/task.test.ts` — boundary-value config knobs, file-local helpers.

## Determinism

- Never assume real time elapses between test operations — no minimums ("ops take ≥1ms") and no
  maximums ("the test finishes within 1s"). `Date.now()` in a test is a smell.
- Make time-dependent behavior deterministic three ways:
  - **Boundary-value config**: choose knob values that decide the branch by arithmetic, not by
    timing — a `-1` idle threshold makes every claim stale; `Number.MAX_SAFE_INTEGER` makes none
    ever stale; `spinThresholdMs: 0` forces the park branch.
  - **Timestamps as authored data**: write sentinel absolutes (`awakeAt: 0`, an epoch constant)
    into rows; a value at the epoch is due/aged for any threshold.
  - **`withFakeClock(seedTimestampMs, fn)`** (`sdk/server/src/testing/clock.ts`): freezes the JS
    clock so aged state is minted through the real code paths. Callers wrap seeds; seed helpers
    stay clock-neutral. Integration-only (test files run sequentially in one process).
- Use these tools only where the test's semantics need them. The fake clock earns its place
  where state must look stale or aged (a recovery threshold, an age cap keyed on a row id's
  mint time), not where mere status suffices. Derive each piece of harness machinery from what
  the test asserts; don't inherit it from the neighboring test.
- Waits ride event-signaled promises (see `lib/src/async/latch.ts`), never polling loops or
  sized sleeps. The one legitimate fixed wait is an absence check: wait a window, assert nothing
  changed.
- Assert async rejections with a floating `expect(promise).rejects.toThrow(...)` — do not await
  it and do not rewrite it as try/catch.

## Seeding (integration tests)

- Seed through the paths production takes: create runs via the services, promote and publish via
  the daemons, claim via the state machine transition. A hand-built row can encode a state the
  system cannot produce, and a test seeded with an impossible state can pass against machinery
  that never works in production.
- Layering: routers are not a seeding layer (they add auth/serialization noise and have their
  own tests); services and daemons are the invariant-enforcing seams; repositories are for
  assertion reads only.
- The daemon harness (`createDaemonHarness` in `sdk/server/src/testing/`) provisions what needs
  lifecycle and reset: the database connection, a scriptable fake publisher (verified on
  teardown), and a daemon context. Take pure filler data (request contexts, rows) from the
  factories in `sdk/server/src/testing/`.

## Assertions

- Expectations compare whole arrays with matchers —
  `expect(rows).toEqual([expect.objectContaining({ ... })])` — never `rows[0]?.field` inside an
  `expect`. This pins count and content together.
- Captures (probes, helper lookups) may index only after the count is pinned:
  `expect(rows).toHaveLength(1)` then `rows[0]`. `rows[0]!` with a
  `biome-ignore ...: the length has already been asserted` comment is the accepted narrowing.
- Merge related equality fields into one `objectContaining` (include ids). An ordered comparison
  (`toBeGreaterThan`) gets its own assertion line — no asymmetric ordering matcher exists.
- An absence assertion must be a read that would have shown the row if it existed.

## Shape

- One behavior per test. The name is one honest sentence — it must not claim anything the body
  doesn't assert.
- Pick fixture data semantically orthogonal to the subject: don't give a time-based test
  time-shaped input.
- Capture baselines from operation responses (a transition's returned revision, attempts) rather
  than re-fetching state before the action.
- Mutation-test your assertions: if the behavior under test were deleted, would this test fail?
  Baselines captured before an intermediate step, or comparisons that hold vacuously (0 === 0),
  are the common failure.
