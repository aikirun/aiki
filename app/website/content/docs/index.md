---
title: Aiki Documentation
description: Build durable, reliable workflows in TypeScript.
---

<p align="center">
  <img src="/assets/aiki-logo-combo.svg" alt="Aiki" height="80">
</p>

Welcome to the Aiki documentation! This guide will help you build durable, reliable workflows in TypeScript.

## 🚀 Getting Started

New to Aiki? Start here:

- **[Quick Start](/docs/getting-started/quick-start)** - Get up and running
- **[Installation](/docs/getting-started/installation)** - Detailed setup instructions
- **[Your First Workflow](/docs/getting-started/first-workflow)** - Build a complete workflow from scratch

## 📚 Core Concepts

Understand the building blocks:

- **[Workflows](/docs/core-concepts/workflows)** - Define long-running business processes
- **[Tasks](/docs/core-concepts/tasks)** - Individual units of work
- **[Events](/docs/core-concepts/events)** - Let external systems signal running workflows
- **[Sleeps](/docs/core-concepts/sleeps)** - Durable timers that survive restarts
- **[Schedules](/docs/core-concepts/schedules)** - Trigger workflows on a recurring basis
- **[Workers](/docs/core-concepts/workers)** - Execute workflows in your infrastructure
- **[Client](/docs/core-concepts/client)** - Connect to the Aiki server, embedded or remote

## 🎯 Guides

Best practices and patterns:

- **[Dependency Injection](/docs/guides/dependency-injection)** - Inject services and dependencies into tasks and workflows
- **[Reference IDs](/docs/guides/reference-ids)** - Custom identifiers for workflows and events
- **[Retry Strategies](/docs/guides/retry-strategies)** - Configure automatic retries for tasks and workflows
- **[Determinism](/docs/guides/determinism)** - Workflow determinism and task idempotency
- **[Refactoring Workflows](/docs/guides/refactoring-workflows)** - Safely modify running workflows
- **[Reliable Hooks](/docs/guides/reliable-hooks)** - Trigger durable follow-up actions on workflow completion/failure/cancellation
- **[IAM](/docs/guides/iam)** - Multi-tenancy, API keys, and dashboard auth — optional, off by default

## 🏗 Architecture

Deep dive into system design:

- **[Overview](/docs/architecture/overview)** - High-level architecture and design principles
- **[Server](/docs/architecture/server)** - Workflow orchestration and state management
- **[Subscribers](/docs/architecture/subscribers)** - Work discovery and fault tolerance
- **[Crash recovery](/docs/architecture/cam)** - Underlying replay-based crash recovery mechanism

## 🔗 Quick Links

- [GitHub Repository](https://github.com/aikirun/aiki)
- [Discord](https://discord.aiki.run)
- [Examples](https://github.com/aikirun/aiki/tree/main/examples/src/workflows)
- [License](https://github.com/aikirun/aiki/blob/main/LICENSE)
