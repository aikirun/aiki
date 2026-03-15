---
marp: true
theme: default
paginate: true
backgroundColor: #f8f9fe
color: #0f172a
style: |
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  section {
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f8f9fe;
    padding: 40px 60px;
  }

  h1 {
    font-family: 'Inter', sans-serif;
    font-weight: 800;
    letter-spacing: -0.03em;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 0.5em;
  }

  h2 {
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.02em;
  }

  h3 {
    font-family: 'Inter', sans-serif;
    font-weight: 600;
    color: #334155;
  }

  strong {
    color: #7c3aed;
  }

  code {
    background: #e2e8f0;
    color: #1e293b;
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 0.95em;
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
  }

  pre {
    background: #f1f5f9;
    border-radius: 12px;
    padding: 1.2em 1.5em;
    border: 2px solid #cbd5e1;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
    font-size: 0.75em;
    line-height: 1.6;
  }

  pre code {
    background: transparent;
    padding: 0;
    font-size: 1em;
    color: #334155;
    letter-spacing: 0.01em;
  }

  a {
    color: #7c3aed;
  }

  table {
    font-size: 0.85em;
    border-collapse: collapse;
    width: 100%;
  }

  th {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 12px 16px;
    text-align: left;
    font-family: 'Inter', sans-serif;
    font-weight: 600;
  }

  td {
    padding: 12px 16px;
    border-bottom: 1px solid #e2e8f0;
    color: #334155;
  }

  tr:nth-child(even) {
    background: #ffffff;
  }

  tr:nth-child(odd) {
    background: #f1f5f9;
  }

  blockquote {
    border-left: 4px solid #667eea;
    padding-left: 1em;
    margin-left: 0;
    font-style: italic;
    color: #64748b;
    background: #ffffff;
    padding: 1em;
    border-radius: 0 8px 8px 0;
  }

  ul, ol {
    color: #334155;
  }

  li {
    margin-bottom: 0.5em;
  }

  section.lead {
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;
  }

  section.lead h1 {
    font-size: 3.5em;
  }

  .muted {
    color: #64748b;
  }

  .emoji-large {
    font-size: 4em;
    margin-bottom: 0.3em;
  }

  section::after {
    color: #94a3b8;
    font-size: 0.8em;
  }
---

<!-- _class: lead -->

# Durable Execution

**Rethinking How We Build Distributed Systems**

<br>

<span class="muted">github.com/aikirun/aiki</span>

---

# Let's Build an Order System

<!-- 🖼️ IMAGE: Shopping cart icon → 30-minute timer → Payment ✓ or Timeout ⏰ -->

**Business Requirements:**

1. User places order → reserve inventory (30-minute hold)
2. User makes payment within 30 minutes
3. If payment received → fulfill order
4. If timeout → release inventory

Simple, right? Let's code it.

---

# The North Star ⭐

What we *want* to express:

```typescript
await createOrder(orderId);
await reserveInventory(orderId);

const payment = await waitForPayment(orderId, {
  timeout: { minutes: 30 }
});
if (payment) {
  await fulfillOrder(orderId);
} else {
  await releaseInventory(orderId);
}
```

---

# First Implementation

```typescript
// Endpoint 1: User places order
async function placeOrder(orderId, items) {
  await createOrder(orderId);
  await reserveInventory(orderId, items);
  return { orderId, message: "Complete payment within 30 minutes" };
}

// Endpoint 2: Payment webhook
async function handlePayment(orderId, paymentDetails) {
  await updateOrderStatus(orderId, 'paid');
  await fulfillOrder(orderId);
}
```

---

# Problem: What About Timeouts?

"We're seeing orders stuck in `pending_payment` from days ago. Inventory is still reserved but customers never paid."

**We need to release inventory after 30 minutes if no payment.**

---

# Solution: Add a Polling Job

```typescript
// Poll every 5 minutes for unpaid orders
setInterval(async () => {
  const unpaidOrders = await findUnpaidOrders();

  for (const {orderId} of unpaidOrders) {
    await releaseInventory(orderId);
    await db.update({ orderId, status: 'expired' });
  }
}, 5 * 60 * 1000);
```

---

# Problem: Crashes Break Atomicity

"Customer paid but order was never fulfilled."

```typescript
async function handlePayment(orderId, paymentDetails) {
  await updateOrderStatus(orderId, 'paid'); // ✅ Committed

  💥 // Server crashes here

  await fulfillOrder(orderId);      // ❌ Never executes
}
```

**Payment made but order never fulfilled.**

---

# Solution: Outbox Pattern

```
┌───────────┐   1. Single Transaction    ┌─────────────────────────┐
│    API    │ ─────────────────────────► │        Database         │
│ (Handler) │   ✅ Both or ❌ Neither    │  ┌───────┐ ┌─────────┐  │
└───────────┘                            │  │Orders │ │ Outbox  │  │
                                         │  └───────┘ └─────────┘  │
                                         └────────────┬────────────┘
                                                      │
                                         2. Poll      │
                                         ┌────────────┘
                                         ▼
                                   ┌───────────┐
                                   │  Worker   │ ──► Execute tasks
                                   │           │ ──► Mark processed
                                   └───────────┘     🔁 Retry on crash
```

---

# Solution: Outbox Pattern (Step 1)

Record your intent in the same transaction:

```typescript
async function handlePayment(orderId, paymentDetails) {
  await db.transaction(async (tx) => {
    await tx.update('orders', { orderId, status: 'paid' });
    await tx.insert('outbox', { orderId, processed: false });
  });
}
```

**Now both succeed or both fail. No partial state.**

---

# Solution: Outbox Pattern (Step 2)

A separate worker processes the outbox:

```typescript
// Outbox worker - polls for pending tasks
setInterval(async () => {
  const tasks = await db.query('SELECT * FROM outbox WHERE processed = false');

  for (const task of tasks) {
    await fulfillOrder(task.orderId);
    await db.update('outbox', { id: task.id, processed: true });
  }
}, 1000);
```

**The outbox is just a task queue in your database.**

---

# Alternatively: Use a Message Queue

```
┌──────────┐     publish      ┌─────────────┐     consume     ┌──────────┐
│ Producer │ ──────────────►  │    Queue    │ ──────────────► │ Consumer │
│ (API)    │                  │  (durable)  │                 │ (Worker) │
└──────────┘                  └─────────────┘                 └──────────┘
                                    │
                           💾 Messages persist
                           🔄 Redelivery on failure
```

---

# Alternatively: Use a Message Queue

```typescript
async function handlePayment(orderId, paymentDetails) {
  await queue.publish('process-payment', { orderId, paymentDetails });
}

// Queue consumer handles messages
queue.consume('process-payment', async (msg) => {
  await updateOrderStatus(msg.orderId, 'paid');
  await fulfillOrder(msg.orderId);
});
```

**Queue guarantees delivery. If consumer crashes, message is redelivered.**

---

# Where We Are Now

<!-- 🖼️ IMAGE: Rube Goldberg machine - overly complex contraption -->

```
              ┌─────────────────────────────────────────────────────┐
              │  Order Endpoint → DB + Reserve Inventory            │
              │         ↓                                           │
              │  Payment Webhook → Outbox (or Queue)                │
              │         ↓                                           │
              │  Worker/Consumer → Fulfill + Confirm                │
              │         ↓                                           │
              │  Timeout Poller (every 5 min) → Release Inventory   │
              └─────────────────────────────────────────────────────┘
```

**Four separate components for one workflow.**

---

# Problem: Race Condition

```
Timeout Poller:                       Outbox Worker / Queue Consumer:

query pending orders...
  ✅ Finds order (status = pending)

                                      update status = 'paid'
                                      fulfillOrder() ✅

releaseInventory() ✅
  (using stale query result)

💥 Order fulfilled AND inventory released
```

**Fix?** Database locking, optimistic concurrency... more complexity.

---

# What Happened to Our Code?

**We wanted:**
```typescript
await createOrder(orderId);
await reserveInventory(orderId);
const payment = await waitForPayment(orderId, { timeout: { minutes: 30 } });
if (payment) { /* fulfill */ } else { /* release */ }
```

**We got:**
- REST endpoints + Outbox/Queue + Workers + Pollers
- Database locking for race conditions
- Defensive code scattered everywhere

---

<!-- _class: lead -->

<div class="emoji-large">🪢 → ➡️</div>

# There's a Better Way

---

<!-- _class: lead -->

# Durable Execution

> Sequential code that survives crashes, waits efficiently, and retries automatically.

---

<!-- _class: lead -->

# Introducing Aiki

**Durable execution platform**

<br>

<span class="muted">github.com/aikirun/aiki</span>

---

# Let's See It

Remember the North Star?

```typescript
await createOrder(orderId);
await reserveInventory(orderId);
const payment = await waitForPayment(orderId, { timeout: { minutes: 30 } });
if (payment) { /* fulfill */ } else { /* release */ }
```

---

**With Aiki, you write.**

```typescript
import { task } from "@aikirun/task";

const createOrder = task({
  name: "create-order",
  async handler(orderId: string ) { 
    /* order creation */ 
  },
});

const reserveInventory = task({ /* ... */ });

const releaseInventory = task({ /* ... */ });

const fulfillOrder = task({ /* ... */ });
```

---

```typescript
import { event, workflow } from "@aikirun/workflow";

const processOrderV1 = workflow({ name: "process-order" }).v('1.0.0', {
  async handler(run, orderId: string) {
    await createOrder.start(run, orderId);
    await reserveInventory.start(run, orderId);

    const payment = await run.events.paymentReceived.wait({ timeout: { minutes: 30 } });
    if (payment.timeout) {
      await releaseInventory.start(run, orderId);
    } else {
      await fulfillOrder.start(run, orderId);
    }
  },
  events: { 
    paymentReceived: event<{ amount: number }>() 
  },
});
```

---

# Event Loop

```
Time:   ────────────────────────────────────────────────────────────────────────────────────────►

             Client A             Client B
             GET /users           GET /orders
                │                    │
                ▼                    ▼
Thread: ───────[A]───┬───[free]──────[B]───┬───[free]─────────[B callback]─────[A callback]────►
                     │                     │                        ▲               ▲
                     │                     │                        │               │
                 I/O ▼                 I/O ▼                        │               │
OS:     ──────────────[A: fetch users]──────[B: fetch orders]──── ──┴───────────────┴──────────►
                                                                done       done
```

---

# Distributed Event Loop

```typescript
const payment = await run.events.paymentReceived.wait({
  timeout: { days: 30 }  // 👈 Wait for 30 DAYS
});
await fulfillOrder.start(run, { orderId });
```

---

# Replay Based Resumption

**First Execution:**
```
[Task A] → [Task B] → [wait event] ⏸️ Worker released
   ↓          ↓           ↓
  💾 DB      💾 DB       💾 DB
```

**After Wait:**
```
[Task A] → [Task B] → [wait event] → [Task C]
 ⏭️ skip    ⏭️ skip     ⏯️ resume    ✅ executes
```

---

# What Happens on Crash?

```
1. updateOrderStatus.start(...)  ✅ Persisted
💥 SERVER CRASHES
2. fulfillOrder.start(...)       ❌ Not executed
```

---

# Challenges with Replay

Replay-based resumption faces two fundamental challenges:

**1. Result Matching**

**2. Determinism**

---

# Aiki's Approach: Content-Addressing

**Result Matching:** Tasks are identified by `hash(name + input)`

Results are stored in a **map**, not an ordered log.

```typescript
// Different inputs → different addresses
await getCreditScore.start(run, { ssn: borrowerSsn });   // address A
await getCreditScore.start(run, { ssn: guarantorSsn });   // address B

// Reorder freely — each address resolves independently
```

---

# Same Task, Same Input

Each address maps to a **result queue**. Multiple calls = multiple entries.

```typescript
await sendEmail.start(run, { to: "user@a.com" }); // → queue[0]
await sendEmail.start(run, { to: "user@a.com" }); // → queue[1]
// Both execute. Each result stored in order.

// On replay, each call consumes the next entry:
await sendEmail.start(run, { to: "user@a.com" }); // ← queue[0]
await sendEmail.start(run, { to: "user@a.com" }); // ← queue[1]
```

---

# Flexible Code Evolution

Three structural changes are safe during replay:

```
Original: taskA → taskB → taskC    (all executed)

Reorder:  taskC → taskA → taskB           ✅ same addresses, any order
Remove:   taskA → taskC                   ✅ fewer entries consumed
Append:   taskA → taskB → taskC → taskD   ✅ all previous consumed
```

**Deploy code changes without migrating active workflows.**

---

# Divergence Detection

What if code changes while a workflow is in flight?

```
Insert:   Previous: taskA →           taskC
          Current:  taskA → taskB → taskC
                                ↑
          taskC unconsumed, taskB is new → Error

Append:   Previous: taskA → taskB
          Current:  taskA → taskB → taskC
                                     ↑
          all previous consumed → taskC executes safely
```

**Rule:** No new task executes while unconsumed entries remain.

---

# The Rule of Replay

**Non-deterministic operations belong in tasks, not workflow code.**

```typescript
// ❌ Different value on every replay
const orderId = crypto.randomUUID();
await run.sleep({ hours: 1 });
// orderId is DIFFERENT after sleep!


// ✅ Task result is stored — same value on replay
const orderId = await generateId.start(run);
await run.sleep({ hours: 1 });
// orderId is SAME after sleep
```

`Date.now()`, `Math.random()`, `fetch()` → wrap them in tasks.

---

# Architecture

```
                           ┌─────────────────────────────────────────────────────────────────┐
                           │                        Your Application                         │
                           │          (Uses Aiki SDK to write & start workflows)             │
                           └───────────────────────────────┬─────────────────────────────────┘
                                                           │
                                                           ▼
                           ┌─────────────────────────────────────────────────────────────────┐
                           │                          Aiki Server                            │
                           │          (Orchestration, Task Management, Storage)              │
                           └───────────────────────────────┬─────────────────────────────────┘
                                                           │
                                                           ▼
                                               ┌───────────────────────┐
                                               │     Message Queue     │
                                               └───────────┬───────────┘
                                                           │
                                                           ▼
                           ┌─────────────────────────────────────────────────────────────────┐
                           │       Worker A        │       Worker B        │     Worker C    │
                           │   (Your workflow runs │  (Your workflow runs  │  (Your workflow │
                           │    in your infra)     │   in your infra)      │   runs here)    │
                           └─────────────────────────────────────────────────────────────────┘
```

---

# Running It

```typescript
async function placeOrder(orderId, items) {
  await processOrderV1.with()
    .opt("reference", { id: orderId })
    .start(aikiClient, orderId);
  return { orderId, message: "Complete payment within 30 minutes" };
}

async function handlePayment(orderId, paymentDetails) {
  const event = processOrderV1.events.paymentReceived;
  await event.sendByReferenceId(aikiClient, orderId, {
    amount: paymentDetails.amount,
  });
}
```

---

# Real-World Use Cases

---

# The Fundamental Shift

We've been solving infrastructure problems in application code.

**Durable execution moves those concerns back to where they belong: the platform.**

---

# Try It Tonight

**Visit https://aiki.run**

```bash
git clone https://github.com/aikirun/aiki
cd aiki
docker-compose up
```

---

<!-- _class: lead -->

# Questions?

⭐ **github.com/aikirun/aiki**
