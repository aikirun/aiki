---
title: Content-Addressed Memoization for Durable Execution
published: true
description:
tags: distributedsystems, architecture, workflows, orchestration
---

Durable execution platforms let you write long-running workflows as ordinary async functions that survive process crashes. Two broad approaches exist for recovery. Checkpoint-based systems snapshot the entire execution state at defined points, restoring it directly on recovery. Replay-based systems re-execute the workflow's code from the beginning, returning previously-recorded task results so the workflow arrives at the same point without repeating real work.

This essay focuses on replay-based systems, and specifically on what happens when workflow code changes while workflows are in flight. If every change is deployed as a new workflow version, replay compatibility is not a concern. But long-running workflows can be in flight for days or weeks, and waiting for all runs to drain before deploying is not always practical. The dominant replay approach, Positional Replay, makes this reconciliation fragile: safe refactoring operations break replay, and in some implementations, input changes silently corrupt results. This essay describes Content-Addressed Memoization (CAM), a more refactoring-tolerant foundation for replay.

---

## How Positional Replay Works

Platforms like Temporal use **Positional Replay (PR)**. When a workflow executes for the first time, the platform records each side-effecting operation (task execution, timer start, event wait) as an entry in an ordered, append-only history log. Each entry occupies a fixed position in the sequence.

When the workflow replays, the runtime walks through this log with a cursor. At each step, it checks whether the command the code wants to issue matches the entry at that position: the **command type** (e.g., "execute task," "start timer") and the **task name**. If they match, the runtime returns the previously recorded result and advances the cursor. If they don't, it throws a Non-Deterministic Error (NDE).

In the base model, PR matches by position and command type only; it does not compare **input payloads**. Some implementations extend this with input validation during replay, catching changes that would otherwise go undetected, but at the cost of additional strictness, as discussed [below](#pr-with-input-validation). Without input validation, changing task input values, which are just local variable values from the workflow's perspective, falls squarely into "won't cause NDE."

Identity in Positional Replay is *positional*: the first task execution command matches the first task entry in the log, the second matches the second, and so on.

---

## The Refactoring Problem

Because identity is positional, any structural change to workflow code breaks in-flight replays. Inserting a new task before a recorded one shifts all subsequent commands out of alignment. Removing a recorded task leaves an orphaned entry with no matching command. Reordering two different task types puts the wrong command type at each position.

The standard workaround is explicit patching. PR platforms provide APIs to record version markers in the history, letting the runtime branch between old and new code paths on replay. This is a deliberate design choice, treating workflow code as a versioned state machine, much like database schema migrations. But it imposes real cost: every refactoring operation requires version guards, and over time workflows accumulate layers of branching logic dedicated to replay compatibility.

---

## The Input Change Blind Spot

The refactoring problem is well-known. The input change blind spot is less discussed, and affects PR implementations that don't validate input payloads during replay.

Consider a loan application workflow with two calls to the same task type, `getCreditScore`, with different inputs:

```typescript
async function handler(input) {
    const borrowerScore = await getCreditScore({ ssn: input.borrowerSsn });
    const guarantorScore = await getCreditScore({ ssn: input.guarantorSsn });

    // Wait for a human underwriter to approve the application.
    // This can take hours or days — the workflow sleeps durably.
    const review = await events.underwriterReview.wait();

    await submitApplication({
        borrowerScore,
        guarantorScore,
        reviewNotes: review.notes,
    });
}
```

Both `getCreditScore` tasks complete. The history records them at positions 1 and 2. The workflow then pauses, waiting for a human underwriter to review the application, a step that can take hours or days. While the workflow is waiting, a developer refactors the code and swaps the order of the two calls:

```typescript
async function handler(input) {
    const guarantorScore = await getCreditScore({ ssn: input.guarantorSsn }); // 🔀
    const borrowerScore = await getCreditScore({ ssn: input.borrowerSsn });  // 🔀

    const review = await events.underwriterReview.wait();

    await submitApplication({
        borrowerScore,
        guarantorScore,
        reviewNotes: review.notes,
    });
}
```

When the underwriter eventually submits their review, the workflow resumes and replays from the beginning. Positional Replay sees `getCreditScore` at position 1, checks the history, finds `getCreditScore` at position 1. Match. It returns the result from the *first* recorded execution. But the first recorded execution fetched the *borrower's* credit score, while the code now assigns it to `guarantorScore`. The second call similarly gets the guarantor's score assigned to `borrowerScore`.

No error is raised. The workflow proceeds to `submitApplication` with the scores swapped: the borrower's credit score is submitted as the guarantor's, and vice versa. A loan approval or denial is made on incorrect data.

The input blind spot is a direct consequence of positional identity. If you identify tasks by position, you cannot detect changes to what happens *at* that position.

### PR with Input Validation

Some PR implementations address this by comparing input payloads during replay. When the code produces an input that differs from what was recorded at that position, the runtime throws an NDE instead of silently returning the wrong result.

This eliminates the blind spot. Every input change is caught, which is the right behavior since silent wrong results are the worst failure mode. But identity is still positional, which means the refactoring problem remains fully intact. Reordering two tasks throws an NDE, even when the two tasks have different names and different inputs, and returning the correct result for each would be straightforward if the runtime matched by content rather than position. Removing a task throws an NDE, even when the task already executed and nothing can undo its effects. Reordering and removal can be mechanically safe during replay, but positional identity cannot distinguish them from dangerous changes.

---

## A React Analogy

React developers will recognize this pattern. React's reconciliation algorithm uses keys to match elements across renders:

- **Array index as key** (analogous to PR): Inserting an element at the beginning shifts all indices, causing React to misidentify components and produce incorrect renders. This is why the React docs warn against using index as key.

- **Content-based key** (analogous to CAM): Stable identifiers tied to the data survive insertions and reorderings. React correctly matches each element regardless of its position in the array.

Positional Replay is index-as-key for workflow history. Content-Addressed Memoization is stable keys.

---

## How Content-Addressed Memoization Works

CAM replaces positional identity with content-derived identity. Instead of looking up task results by position in a log, CAM derives an **address** from the task's **name** and the **hash of its input**:

```
address = f(taskName, hash(input))
```

The input is serialized deterministically and hashed (e.g., SHA-256). Deterministic serialization is slightly more expensive than regular serialization. It must sort object keys, normalize number formatting, and handle edge cases consistently, though this overhead is small relative to the I/O cost of actually executing a task. The more important concern is stability: if the same logical input produces different byte sequences across versions, the hash changes and cannot be matched against the memoized result. Implementations should treat serialization as a platform-level dependency with its own stability guarantees. 

How exactly the task name and input hash are combined into an address is an implementation detail. The important thing is that both contribute to the address, making it content-derived rather than position-derived.

Instead of a global event log, each address maps to its result. But what happens when the same task is called twice with identical input? e.g. Two notifications to the same recipient. The address is the same, but the calls are distinct. To handle this, each address maps to a **result queue**: an ordered sequence of results so that when the same task is called multiple times with the same input, each call adds an entry to the queue, and on replay each call consumes the next entry in order. This detail becomes important when we examine what happens when the code changes between executions.

```typescript
tasks: Map<string, TaskResult[]>  // address → results
```

When the workflow replays, each task call computes its address and looks it up in the map. If found, the next unconsumed result in the queue is returned. If the queue is exhausted or the address doesn't exist, the task executes fresh. There is no global cursor walking a sequential log. Each address maintains its own result queue, consumed in order, but addresses are resolved independently. The order in which different addresses are looked up has no effect on the results returned. 

The task map from a previous execution effectively forms a **manifest**: not just which addresses exist, but how many results are recorded under each. The runtime can compare the current execution against this manifest, a property explored in detail [later](#divergence-detection). 

*Note*: The runtime can still emits an ordered event log for observability and debugging. The difference is that replay identity comes from content, not from position in that log.

---

## What Content Addressing Enables

### Reordering

Because identity is derived from content, not position, reordering tasks has no effect on replay. Returning to the loan application example:

```typescript
// Original order
const borrowerScore = await getCreditScore({ ssn: input.borrowerSsn });
const guarantorScore = await getCreditScore({ ssn: input.guarantorSsn });

// Swapped order — CAM returns the correct result for each
const guarantorScore = await getCreditScore({ ssn: input.guarantorSsn }); // 🔀
const borrowerScore = await getCreditScore({ ssn: input.borrowerSsn });  // 🔀
```

Each call produces a different hash (because the SSNs differ), so each maps to the correct memoized result regardless of order. The borrower's score is always returned for the borrower's input, and the guarantor's for the guarantor's.

### Removal

Removing a task doesn't disrupt any other task's address. The removed task's memoized result remains in storage but is simply never looked up:

```typescript
// Original
await validateAddress(input);
await checkInventory(input);

// Removed validateAddress — checkInventory is unaffected
await checkInventory(input);         // returns memoized
```

In PR, this shifts positions and throws an NDE. CAM handles it without positional disruption: `checkInventory`'s address hasn't changed, so it returns the correct memoized result. But `validateAddress`'s entry is now unconsumed. Whether that's safe, and what the runtime should do about it, depends on the [divergence detection](#divergence-detection) model described later.

### Changed Input Detection

If you change a task's input, the hash changes. The new address doesn't match any entry in the map. Unlike base PR without input validation, which silently returns the wrong result, CAM recognizes that the input has changed:

```typescript
// Original
await generateReport({ userId: input.userId, format: "pdf" });

// Changed input — different hash, different address
await generateReport({ userId: input.userId, format: "csv" });
```

PR without input validation silently returns the old result (a PDF) because it only checks position and task name. PR with input validation catches this through a positional mismatch on the input payload. CAM also detects the change; the old entry goes unconsumed and the new address has no memoized result. How exactly the runtime responds to this divergence is described in [Divergence Detection](#divergence-detection).

---

## The Divergence Problem

Content addressing matches task calls to memoized results by name and input. But when the workflow's code changes between the original execution and a replay, previously-recorded entries may go unconsumed, and content addressing alone cannot detect this. PR can: any structural change breaks positional alignment and triggers an NDE. Content addressing, by design, doesn't depend on position, which means it also can't use position as a change detector.

The following scenarios illustrate why this gap matters and why the runtime needs a mechanism to detect it.

### Task Removal

As shown [earlier](#removal), removing a task leaves its entry in the map unconsumed. Without a detection mechanism, the consequences of that task (a payment charged, an email sent) would become invisible to the current execution. The runtime should at least know that the current run no longer accounts for them.

### Uncaptured Dependencies

Any value that can differ between executions (environment variables, feature flags, random numbers, the current date) is a non-deterministic dependency. If a workflow reads such a value directly rather than capturing it inside a task, the value is never part of the execution state:

```typescript
async function handler(input) {
    const useNewFlow = process.env.ENABLE_NEW_FLOW === "true";

    if (useNewFlow) {
        await taskA(input);
    } else {
        await taskB(input);
    }
}
```

If the environment variable changes between the original execution and a replay, the workflow takes a different branch. PR detects this: the original execution recorded `taskA`; the replay now produces `taskB`, and the positional mismatch triggers an NDE. Without a detection mechanism, content addressing would allow `taskB` to execute fresh while `taskA`'s entry sits in the map, unconsumed.

Both PR and content addressing recommend the same discipline: wrap non-deterministic reads inside tasks so their results are memoized, or pass them as workflow input so they're fixed for the lifetime of the run:

```typescript
async function handler(input) {
    const config = await getFeatureFlags({ key: "ENABLE_NEW_FLOW" });

    if (config.enabled) {
        await taskA(input);
    } else {
        await taskB(input);
    }
}
```

Now the feature flag's value is memoized. On replay, the task returns the original value, and the workflow takes the same branch regardless of what the environment variable currently says.

This pattern will be familiar to React developers. React's `useEffect` and `useMemo` hooks require you to declare your dependencies explicitly in a dependency array. If you omit a dependency, the hook uses a stale value, the React equivalent of an uncaptured dependency in workflow code. Just as React's linting rules warn about missing dependencies, workflow code benefits from the discipline of capturing all non-deterministic inputs inside tasks.

### Stale Observations

The examples above involve divergence between code and execution history. But divergence becomes especially dangerous when someone outside the system has already committed to the old execution's results: made a decision, taken an action, or approved a request based on task outputs that the new code would produce differently.

An event wait is a point where this happens. Consider the loan application workflow again. The two credit score tasks complete, and the workflow pauses at the event wait. The underwriter reviews the application, reading the scores that were fetched, and submits their approval. While the workflow was waiting, a developer changed one of the credit score tasks:

```typescript
// Original
const guarantorScore = await getCreditScore({ ssn: input.guarantorSsn });

// Changed — different scoring provider
const guarantorScore = await getExternalCreditScore({ ssn: input.guarantorSsn });
```

When the workflow resumes and replays, `getExternalCreditScore` is a new address with no memoized result. If the runtime allowed it to execute fresh, it would return a different score. The event wait would return the memoized approval. The workflow would proceed to `submitApplication` with scores the underwriter never reviewed.

The underwriter's decision is causally linked to the scores that existed at the time of approval, but this dependency lives in the real world, not in the execution graph. The runtime needs a way to detect that the current execution has diverged from the one an external actor committed to.

---

## Divergence Detection

The task map itself is the **manifest** introduced earlier: not just which addresses exist, but how many results are recorded under each. Crucially, the manifest is unordered. This is what enables reordering safety: the same addresses consumed the same number of times in a different order produce identical variable bindings, because each address resolves to a fixed memoized result independently.

During replay, the runtime tracks consumption at the queue level: each task call that matches an existing address consumes the next entry in that address's queue. The runtime always knows how many entries remain unconsumed across all queues. This enables a single, powerful check.

**Execution-time check.** When the workflow encounters a task whose address has no remaining unconsumed entries in the manifest, either because the address doesn't exist or because its queue is exhausted, the runtime checks whether unconsumed entries remain in other queues. If they do, the execution has diverged: previously-recorded results exist that the current code path hasn't consumed, and a new task is about to execute. The runtime errors immediately, before the new task executes.

```
Previous execution: taskA → taskB → taskC
Current execution:  taskA → taskD
                                ↑
                    taskB and taskC unconsumed
                    taskD is new
                    → Error before taskD executes
```

The runtime can tell the developer exactly which tasks were not consumed, making the error actionable.

> A replay is valid if and only if the multiset of addresses consumed during replay is a subset of the multiset recorded in the manifest, and no new address is executed while any recorded entry remains unconsumed.

The same check catches a common refactoring move: inserting a new task between existing ones. If the developer adds a new task before previously-recorded tasks have been consumed, the check fires:

```
Previous execution: taskA → taskC
Current execution:  taskA → taskB → taskC
                                ↑
                    taskC still unconsumed
                    taskB is new
                    → Error before taskB executes
```

Appending, by contrast, is safe. If all previous tasks have been consumed before the new one is encountered, there are no unconsumed entries and the new task executes normally:

```
Previous execution: taskA → taskB
Current execution:  taskA → taskB → taskC
                                     ↑
                    all previous tasks consumed
                    taskC is new — executes safely
```

### Why Removal Is Safe

If every task the workflow executes during replay matches an existing manifest entry (consuming only entries that were previously recorded, and fewer of them), nothing new was executed. The removed task's entries sit unused, but the task already ran in the real world; not consuming its memoized result doesn't undo that. Removing the task from code doesn't reverse a payment or unsend an email. That requires compensation logic, which is a business concern, not a replay mechanics concern.

If the removal changes downstream behavior (for example, a later task's input depended on the removed task's result), the downstream task produces a different address. That address has no entries in the manifest, so the divergence check fires. Removal is safe precisely when it doesn't alter the remaining execution, and the manifest enforces this automatically.

The runtime can still surface unconsumed manifest entries as a diagnostic. This is observability, not a safety gate.

### Why Reordering Is Safe

Reordering is safe — in the mechanical sense that replay produces identical variable bindings — when the replay consumes the same addresses the same number of times as the original execution. This is where content addressing provides its strongest advantage over PR.

Because the manifest is unordered, consuming the same addresses in a different order during replay produces identical results. Both results are already memoized, and each content address resolves to a fixed memoized result independently of every other address. Swapping the order of two tasks just means looking up two map entries in a different sequence; the values returned are the same.

The important boundary: this holds for tasks with distinct addresses. Tasks that share an address (same name, same input) share a result queue, and their relative order within that queue must be preserved. The loan application example works because the two `getCreditScore` calls have different SSNs, producing different hashes and therefore different addresses. Two calls with identical input would share a queue and could not be safely reordered.

What about reordering tasks where one depends on the other's output? If a developer moves `taskB(a)` before the `taskA` call that produces `a`, the input to `taskB` changes (it's now `undefined` or whatever the uninitialized value is). A different input means a different hash, a different address, and that address has no entries in the manifest. The divergence check fires. CAM doesn't need to reason about data dependencies explicitly. Content addressing makes them structural. An unsafe reorder changes the addresses themselves, so the precondition (same addresses, same number of times) is no longer met.

PR cannot offer any of this. Even PR with input validation — the strictest variant — throws an NDE on any reorder, because positional matching inherently depends on execution order.

---

## Summary

| Aspect | PR | PR + Input Validation | CAM |
|--------|----|-----------------------|-----|
| Task identity | Position in sequence | Position in sequence | Task name + hash(input) |
| State structure | Ordered append-only log | Ordered append-only log | Structured map |
| Reorder tasks | ❌ NDE | ❌ NDE | ✅ Safe |
| Remove tasks | ❌ NDE | ❌ NDE | ✅ Safe (consumes fewer entries) |
| Append tasks | ✅ Safe | ✅ Safe | ✅ Safe |
| Insert tasks (non-append) | ✅ NDE | ✅ NDE | ✅ NDE (unconsumed entries exist) |
| Change task input | ❌ Silent wrong result | ✅ NDE | ✅ NDE (old address unconsumed) |
| Control flow divergence | ✅ NDE | ✅ NDE | ✅ NDE (unconsumed entries exist) |

✅ = correct behavior (allows safe operations, catches dangerous ones)
❌ = incorrect behavior (blocks safe operations or misses dangerous ones)

PR without input validation fails silently on input changes. The workflow completes with incorrect data and no signal. This is the hardest failure to detect because the platform sees nothing wrong.

PR with input validation eliminates the input blind spot, a significant improvement over base PR. But positional identity means reordering and removal also require version guards, even though they cannot cause incorrect results.

CAM uses content-derived identity and an unordered manifest to eliminate both the input blind spot and the positional fragility of PR. Reordering is safe because the same addresses consumed in any order produce identical results. Removal is safe because the workflow consumes only previously-recorded entries - nothing new is executed. Appending is safe in all three systems. Non-append insertion, input changes, and control flow divergence are caught by all three.

CAM's divergence detection does not distinguish between dangerous and harmless input changes. Switching a report format from PDF to CSV triggers the same error as changing a payment amount. This is the same behavior as PR with input validation, and the right default when the runtime cannot know the developer's intent.
