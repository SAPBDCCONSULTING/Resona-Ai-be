# ADR-001 — Tech stack

**Status:** Accepted  
**Date:** 2026-09-15  
**Context:** Phase 1 foundation for Resona AI (HR feedback platform).

## Decision

| Layer | Choice |
|-------|--------|
| HR Dashboard | Next.js 15 (App Router) + TypeScript + Tailwind |
| Employee App | Next.js 15 (separate repo / deploy) |
| API | NestJS modular monolith |
| Database | MongoDB |
| Cache / rate limit / queues | Redis (+ BullMQ later) |
| Auth | Email/password + JWT access + refresh |
| Shared types | `@pulsefeedback/shared` (local `file:./shared`) |

## Consequences

- Stateless API pods; auth via Bearer JWT (no sticky sessions).
- AI and heavy work go on Redis-backed jobs (Phase 4); Phase 1 uses stubs.
- Separate employee app isolates participant load from HR UI.
- Docker Compose runs Mongo + Redis + API for local/dev demos.
