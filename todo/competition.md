Part 1: Aiki vs Temporal vs Inngest - Versioning & Determinism

  Versioning Model

  Temporal: Patching
  // Single function with conditional branches
  export async function onboarding(input: { email: string }) {
    await sendWelcome(input.email);

    if (patched('v2-add-tips')) {
      await sendTips(input.email);
    }

    if (patched('v3-add-promo')) {
      await sendPromo(input.email);
    }
  }
  - ❌ Code becomes cluttered with version checks
  - ❌ Hard to see what each version does
  - ❌ Must maintain all paths in one function

  Inngest: New Function for Breaking Changes
  // v1 function
  export const onboardingV1 = inngest.createFunction(
    { id: "onboarding-v1" },
    { event: "user.created", if: "event.ts < 1700000000" },
    async ({ step }) => {
      await step.run("send-welcome", () => sendWelcome());
    }
  );

  // v2 function (separate)
  export const onboardingV2 = inngest.createFunction(
    { id: "onboarding-v2" },
    { event: "user.created", if: "event.ts >= 1700000000" },
    async ({ step }) => {
      await step.run("send-welcome", () => sendWelcome());
      await step.run("send-tips", () => sendTips());
    }
  );
  - ✅ Separate functions
  - ❌ Manual timestamp routing
  - ❌ No built-in version management

  Aiki: Explicit Versions
  const onboarding = workflow({ name: "onboarding" });

  const v1 = onboarding.v("1.0.0", {
    async exec(input: { email: string }, run) {
      await sendWelcome.start(run, { email: input.email });
    }
  });

  const v2 = onboarding.v("2.0.0", {
    async exec(input: { email: string }, run) {
      await sendWelcome.start(run, { email: input.email });
      await sendTips.start(run, { email: input.email });
    }
  });

  // Start specific version
  await v1.start(client, { email: "user@example.com" });
  await v2.start(client, { email: "user@example.com" });
  - ✅ Each version is self-contained
  - ✅ Type-safe (different input/output types per version)
  - ✅ Explicit version selection at call site
  - ✅ IDE navigation works perfectly

  ---
  Task Memoization / Determinism

  Temporal: Sequence-Based Replay
  // Temporal replays entire event history
  export async function workflow() {
    const a = await activityA();  // Event 1
    const b = await activityB();  // Event 2
    const c = await activityC();  // Event 3
  }

  // On replay: re-executes code, validates against recorded sequence
  // If code order changes → throws non-determinism error

  | Scenario                             | Temporal Behavior                 |
  |--------------------------------------|-----------------------------------|
  | Reorder tasks                        | ❌ Throws                          |
  | Add new task                         | ❌ Throws (unless using patched()) |
  | Same task, same input twice          | ✅ Both execute (sequence-based)   |
  | Non-deterministic input (Date.now()) | ❌ Throws                          |
  | Task rename                          | ❌ Throws                          |

  Inngest: Explicit Step ID
  export const myFunction = inngest.createFunction(..., async ({ step }) => {
    // Must provide step ID for every step
    const a = await step.run("step-a", () => doA());
    const b = await step.run("step-b", () => doB());
    const c = await step.run("step-c", () => doC());
  });

  | Scenario                     | Inngest Behavior                 |
  |------------------------------|----------------------------------|
  | Reorder tasks                | ✅ Safe (ID-based lookup)         |
  | Add new task                 | ✅ Executes fresh                 |
  | Same task, same input twice  | ⚠️ Must use different step IDs   |
  | Non-deterministic input      | ✅ Safe (input not in key)        |
  | Task rename (step ID change) | ⚠️ Warns, re-executes            |
  | Loop execution               | ⚠️ Must generate unique step IDs |

  Aiki: Task Name + Input Hash
  const v1 = onboarding.v("1.0.0", {
    async exec(input, run) {
      // No explicit ID needed - uses task name + input hash
      await sendWelcome.start(run, { email: input.email });
      await sendTips.start(run, { email: input.email });

      // Same task, different input = different execution
      await sendEmail.start(run, { to: "a@example.com" });
      await sendEmail.start(run, { to: "b@example.com" });  // Executes separately

      // Same task, same input = cached
      await sendEmail.start(run, { to: "a@example.com" });  // Returns cached

      // Force re-execution with idempotency key
      await sendEmail
        .withOptions({ idempotencyKey: "reminder" })
        .start(run, { to: "a@example.com" });  // Executes again
    }
  });

  | Scenario                    | Aiki Behavior                                           |
  |-----------------------------|---------------------------------------------------------|
  | Reorder tasks               | ✅ Safe (name + input based)                             |
  | Add new task                | ✅ Executes fresh                                        |
  | Same task, same input twice | ✅ Returns cached (use idempotency key to re-execute)    |
  | Non-deterministic input     | ⚠️ Different hash, re-executes                          |
  | Task rename                 | ⚠️ Orphans cache, re-executes                           |
  | Loop execution              | ✅ Works naturally (different inputs = different hashes) |

  ---
  Side-by-Side Scenarios

  Scenario 1: Loop over users
  // Temporal - works
  for (const user of users) {
    await sendEmail(user.email);  // Each is separate event in sequence
  }

  // Inngest - awkward
  for (const user of users) {
    await step.run(`send-email-${user.id}`, () => sendEmail(user.email));  // Must generate ID
  }

  // Aiki - works naturally
  for (const user of users) {
    await sendEmail.start(run, { to: user.email });  // Different input = different hash
  }

  Scenario 2: Same operation twice
  // Temporal - works
  await sendEmail(to);
  await sendEmail(to);  // Sequence 1 and 2, both execute

  // Inngest - must differentiate
  await step.run("email-1", () => sendEmail(to));
  await step.run("email-2", () => sendEmail(to));

  // Aiki - use idempotency key
  await sendEmail.start(run, { to });  // Executes
  await sendEmail.start(run, { to });  // Returns cached
  await sendEmail.withOptions({ idempotencyKey: "second" }).start(run, { to });  // Executes

  Scenario 3: Add a new step mid-workflow
  // Temporal - must use patched()
  if (patched('add-validation')) {
    await validateUser();
  }
  await sendEmail();

  // Inngest - just add it
  await step.run("validate", () => validateUser());  // Executes on resume
  await step.run("send-email", () => sendEmail());

  // Aiki - just add it
  await validateUser.start(run, input);  // Executes on resume
  await sendEmail.start(run, input);

  Scenario 4: Rename a task
  // Temporal - throws on replay (event history mismatch)

  // Inngest - warns, re-executes (new step ID = new cache key)

  // Aiki - re-executes (new task name = new cache key)
  // Can add warning by comparing accessed paths to previous execution

  ---
  Summary Table

  | Feature                  | Temporal          | Inngest               | Aiki                            |
  |--------------------------|-------------------|-----------------------|---------------------------------|
  | Versioning               | Patching          | New function          | Explicit .v()                   |
  | Memoization key          | Sequence position | Explicit step ID      | Task name + input hash          |
  | Boilerplate              | patched() checks  | Step ID on every step | None (optional idempotency key) |
  | Loops                    | ✅ Works           | ⚠️ Generate IDs       | ✅ Works                         |
  | Reordering               | ❌ Throws          | ✅ Safe                | ✅ Safe                          |
  | Type safety per version  | ❌ No              | ❌ No                  | ✅ Yes                           |
  | Non-deterministic inputs | ❌ Throws          | ✅ Safe                | ⚠️ Re-executes                  |
  | Task rename              | ❌ Throws          | ⚠️ Re-executes        | ⚠️ Re-executes                  |
  | Replay/Reset             | ✅ Built-in        | ✅ Built-in            | ✅ Implementable                 |

  ---
  Part 2: Conversation Conclusions - Action Items

  Runtime & Tooling

  - Move to Bun - eliminates dnt build step, no platform shims
  - Set up Biome for linting and formatting
  - Use tsc for type checking

  SDK Changes

  - Make worker name required - needed for deployment tracking
  - Workers register workflow-versions (not just workflows)
  - Enforce semantic versioning at type level and server
  - Unify platform code - use node: imports, delete .deno.ts / .node.ts shims

  Redis Stream Pattern

  - Change stream key format to workflow:{name}:{version}:{shard?}
  - Workers subscribe only to streams for versions they support

  Deployment Safety

  - Diff-based orphan check on deploy:
    - Detect removed versions
    - Check for running workflows on those versions
    - Check if other workers cover them
    - If orphaned → FAIL deployment
  - Add periodic background health check for orphan detection

  Replay Feature

  - Implement replay/reset API:
    - Delete task state from specified point onwards
    - Re-queue workflow
    - Tasks before reset point return cached results
    - Tasks after reset point re-execute

  Warnings

  - Add warning on task path mismatch - detect when accessed task paths differ from previous execution (similar to Inngest)

  Documentation

  - Document task names as stable contracts (renames are breaking changes)
  - Document non-deterministic input risks
  - Document idempotency key usage

  Multi-language SDKs (Future)

  - Generate OpenAPI spec from Zod schemas
  - Generate SDKs for other languages from OpenAPI
  - Protobuf not needed unless at massive scale

  Aiki Cloud - Managed Workers (Future)

  - V8 isolates initially
  - Containers later for multi-language support
  - CLI bundles code → push to registry → run in isolates



