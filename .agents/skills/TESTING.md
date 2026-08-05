# Testing

Two tiers: `*.test.ts` are hermetic unit tests (`bun run test:unit`, no database);
`*.integration.test.ts` run against a live Postgres (`bun run test:integration`, credentials in
`.env.test` — see DB.md).

Before writing any test, study the exemplars for its tier and match their idioms:

- `sdk/server/src/daemon/publish-pending-outbox-entries.integration.test.ts` — minimal integration shape.
- `sdk/server/src/daemon/recover-overdue-outbox-entries.integration.test.ts` — service-path
  seeding, fake clock, assertion shapes.
- `sdk/workflow/src/run/sleeper.test.ts` — timestamps as authored data.
- `sdk/workflow/src/task.test.ts` — boundary-value config knobs, file-local helpers.
- `sdk/server/src/service/workflow-run-state-machine.test.ts` — exhaustive legality matrix driven
  from a typed case table.

## Determinism

- Never assume real time elapses between test operations — no minimums ("ops take ≥1ms") and no
  maximums ("the test finishes within 1s"). `Date.now()` in a test is a smell.
- Make time-dependent behavior deterministic three ways:
  - **Boundary-value config**: choose knob values that decide the branch by arithmetic, not by
    timing — a `-1` idle threshold makes every claim stale; `Number.MAX_SAFE_INTEGER` makes none
    ever stale; `maxInlineWaitMs: 0` forces the suspend branch.
  - **Timestamps as authored data**: write sentinel absolutes (`wakeupAt: 0`, an epoch constant)
    into rows; a value at the epoch is due/aged for any threshold.
  - **`withFakeClock(seedTimestampMs, fn)`** (`sdk/server/src/testing/clock.ts`): freezes the JS
    clock so aged state is minted through the real code paths. Clock placement follows
    necessity: wrap at the call site when aging is the test's own policy; a seed that
    constitutively requires aged state (a stalled run) owns its clock internally.
    Integration-only (test files run sequentially in one process).
- Use these tools only where the test's semantics need them. The fake clock earns its place
  where state must look stale or aged (a recovery threshold, an age cap keyed on a row id's
  mint time) or where an expectation pins an exact written timestamp, not where mere status
  suffices. Derive each piece of harness machinery from what the test asserts; don't inherit
  it from the neighboring test.
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
- Two harnesses in `sdk/server/src/testing/harness.ts` share one lifecycle (the database
  connection, per-test reset, a scriptable fake publisher verified on teardown) and differ only
  in the injected context: `createDaemonHarness` injects a `DaemonContext`,
  `createServiceHarness` a `NamespaceRequestContext`. Pick by the SUT's seam.
- Seeds (`sdk/server/src/testing/run-seed.ts`) take
  `{ repos, daemonContext?, namespaceRequestContext?, publisher }`: always feed the context your
  harness injected; the other may be omitted (factory default). Take pure filler data (contexts,
  rows) from the fishery factories under `sdk/server/src/testing/data-factory/`, at the path
  mirroring the type each one builds.
- Data factories (fishery `Factory.define`) live under a `data-factory/` subtree, kept apart from
  fakes and harnesses. The same split holds in the `@aikirun/testing` package: factory exports are
  namespaced `@aikirun/testing/data-factory/*`, while the fakes stay at `@aikirun/testing/client`
  and `@aikirun/testing/infra/queue`.

## Assertions

- Expectations compare whole arrays with matchers —
  `expect(rows).toEqual([expect.objectContaining({ ... })])` — never `rows[0]?.field` inside an
  `expect`. This pins count and content together.
- Captures (indexing a row out to reuse a value) are a last resort, not an idiom: authored
  instants let the whole-array assertion carry every field, and asserting row order replaces
  reading out an id to filter by. Where a later step genuinely needs a value that cannot be
  authored, index only after `expect(rows).toHaveLength(n)`; `rows[0]!` with a
  `biome-ignore ...: the length has already been asserted` comment is the tolerated narrowing,
  and its presence is a prompt to ask whether the value could have been authored instead.
- Merge related equality fields into one `objectContaining` (include ids). An ordered comparison
  (`toBeGreaterThan`) gets its own assertion line — no asymmetric ordering matcher exists.
- Timestamps in expectations are exact values, never `expect.any(Number)` — presence-only
  survives a dropped duration or a seconds/ms mix-up. Capture an instant, freeze the clock
  around the one mutating call, and assert the arithmetic
  (`const sleepStartedAt = Date.now()`, then `wakeupAt: sleepStartedAt + durationMs`).
  Seeding the freeze from `Date.now()` is not the real-time smell: nothing depends on the
  value, and a current-time seed keeps the frozen instant after earlier real-time steps so
  ulids stay causally ordered. Scope the freeze to the call under assertion. Timestamps minted
  in one transaction share its single `now` — asserting them against the same instant pins
  that property too. Where the clock cannot be frozen, bracket from both sides
  (`before + duration <= t <= after + duration`); a one-sided bound still passes a doubled
  duration.
- A captured row pins stability, not exactness: comparing against an earlier read proves the
  row didn't change, while its timestamps stay unfrozen wall-clock values. When exactness is
  the point, freeze the instant that minted the row and assert the authored value — the
  whole-array form then needs no capture at all.
- An absence assertion must be a read that would have shown the row if it existed.
- When a test claims "X prevents Y", first prove Y was actually going to happen: assert the
  seeded state is one Y would hit (the claim is old enough to be recovered), then do X, then
  assert Y didn't happen. Without that first assertion the test can pass for a reason other
  than X — a threshold that spares every claim, say — and nothing in the test shows which.

## Shape

- One behavior per test. The name is one honest sentence — it must not claim anything the body
  doesn't assert.
- Test a behavior in the suite of the component that owns it: what a service writes is the
  service suite's contract; how a daemon reads it belongs to the daemon's suite. Don't place a
  test by where you happen to be working.
- Pick fixture data semantically orthogonal to the subject: don't give a time-based test
  time-shaped input.
- Capture baselines from operation responses (a transition's returned revision, attempts) rather
  than re-fetching state before the action.
- Mutation-test your assertions: if the behavior under test were deleted, would this test fail?
  Baselines captured before an intermediate step, or comparisons that hold vacuously (0 === 0),
  are the common failure.
- When the claim is "X leaves Y untouched", mint Y in a state X cannot write: a bystander
  sleep finalized `completed` (a `durationMs: 0` sleep is due for the elapsed-runs daemon
  immediately) against an X that writes `cancelled`. A same-status bystander forces the
  assertion to lean on incidental values; a distinguishable status turns any violation into a
  visible flip. Assert the bystander's outcome columns with their null complements
  (`completedAt` set, `cancelledAt: null`) so finalization is pinned to exactly one outcome.
- When a behavior applies only to one status (a guard like `status = 'claimed'`), test every
  excluded status, not one representative. Build the case table as an object keyed by the
  excluded statuses and pin it with
  `satisfies Record<Exclude<StatusUnion, "claimed">, unknown>`, then `Object.entries(...)` into
  a test per key. The `Record` over `Exclude` makes the table complete by construction: a new
  union member fails the build until it gets an entry, and a typo'd key never compiles.
- When a case table's cells carry a payload, type the payload so a degenerate entry cannot
  compile. The legality-matrix cell shape is `{ reasons?: NonEmptyArray<string> }`: an absent
  cell is the illegal case, `{}` is legal-unguarded, and `NonEmptyArray` forbids the empty guard
  list a plain `string[]` would accept — `{ reasons: [] }` would generate zero accepts tests and
  silently decline every reason.
