TaskFleet

A Web-Based Multi-Agent DevOps Orchestrator

TaskFleet is a browser-based multi-agent DevOps platform that allows developers and small teams to delegate coding tasks to AI agents, execute multiple tasks in parallel, and supervise the entire workflow from a single live dashboard.

Instead of running one AI coding agent at a time, TaskFleet provides isolated workers, a common agent plugin interface, real-time task tracking, GitHub/CI integration, and a security gate for agent-generated code.

Project: Semester Group Project
Program: B.Tech CS
Institution: KIET Group of Institutions

🚀 Problem Statement

Running a single AI coding agent on one task is relatively simple. However, running multiple agents against the same repository simultaneously introduces several coordination problems:

Branch and working-directory collisions

Loss of context about which agent is working on which task

No centralized view of task progress

Difficulty tracking blocked tasks

Manual handling of CI failures and review comments

Security risks from AI-generated code

Vendor lock-in when using a single AI agent

TaskFleet addresses these problems by providing:

Isolated Workers — one task, one agent, one Git branch/worktree.

Agent Plugin Interface — a common interface for different AI coding agents.

Live operations console — real-time task state based on Git, CI, and PR signals.

Feedback Loop — CI failures and review comments can be routed back to the responsible worker.

SecOps Gate — automated security checks before code reaches the merge-ready state.

✨ Key Features

🤖 Multi-Agent Task Execution

Create coding tasks using natural language and assign them to an AI coding agent.

⚡ Parallel Execution

Multiple workers can execute different tasks concurrently without overwriting each other's work.

🌿 Git Worktree Isolation

Every worker receives its own Git branch and worktree, preventing file-level conflicts between agents.

🧠 Coding Agent (M1)

The `coding-agent` is a real tool-calling agent, not a simulated one. For each run it:

1. receives an isolated worktree on `taskfleet/<runId>`,
2. inspects and edits files through path-jailed tools (`read_file`, `list_directory`,
   `search_repo`, `write_file`, `apply_patch`),
3. runs only allowlisted commands and the repository test suite,
4. hands control back to the orchestrator, which produces a real diff, commits,
   pushes the branch, and opens a GitHub pull request when credentials are configured.

Every step is persisted as a `RunEvent` and `RunArtifact` and streamed to the dashboard.
If the provider cannot call tools (for example the offline stub), the run fails with a clear
error; if GitHub is not configured, the commit stays local and PR creation is reported as
unavailable instead of being faked.

See [`docs/implementation/M1.md`](docs/implementation/M1.md) for the full milestone report.

🐳 Docker-Based Worker Isolation

Workers execute inside separate Docker containers to reduce the impact of runaway or malicious agent processes.

🔌 Agent Plugin Architecture

TaskFleet uses a common adapter interface so different agents can be integrated without changing the orchestration core.

Planned/targeted integrations include:

Anthropic Claude API

OpenAI-compatible APIs

CLI-based coding agents

Other agents implementing the TaskFleet adapter contract

📊 Live Operations Dashboard

The dashboard is a dense developer console with six areas:

- **Overview** — live task/run counts, success rate, active runs, recent persisted activity
- **Tasks** — filterable table, create/edit/delete, priority, assignment, and execution history
- **Runs** — every persisted run with real provider/model, status, duration, and token usage
- **Run detail** — ordered execution timeline streamed over SSE plus the persisted event history
- **Agents** — registered agents, capabilities, per-agent run/success stats, and stub/live status
- **Security & Integrations** — scanner availability, security gate, provider and webhook configuration

Every value on screen comes from the API and SQLite database. There is no mock data or simulated
progress. Run updates are delivered through Server-Sent Events, eliminating manual refreshes.

🔄 CI & Review Feedback Loop

GitHub commits, pull requests, CI results, and review comments are used to derive task state.

When CI fails or a reviewer requests changes, the feedback can be routed back to the same worker so the agent can attempt a fix.

🛡️ SecOps Pipeline

Agent-generated code is intended to pass automated security checks before reaching the merge-ready stage:

Gitleaks — secret scanning

Trivy — dependency/container scanning

Semgrep — static application security testing (SAST)

🔐 GitHub OAuth

Team members can authenticate using GitHub OAuth with scoped repository access.

🏗️ System Architecture

TaskFleet follows a three-layer architecture.

┌─────────────────────────────────────────────┐
│              Presentation Layer             │
│     React + TypeScript + Vite + Tailwind    │
│                                             │
│  Task Creation │ Tasks │ Runs │ Agents      │
└──────────────────────┬──────────────────────┘
                       │
                   REST + SSE
                       │
┌──────────────────────▼──────────────────────┐
│             Orchestration Layer             │
│         Node.js + Fastify + TypeScript      │
│                                             │
│ Task Lifecycle │ Sessions │ Orchestrator    │
│ SSE Server │ GitHub Integration             │
└──────────────────────┬──────────────────────┘
                       │
                 Worker Management
                       │
┌──────────────────────▼──────────────────────┐
│               Execution Layer               │
│                                             │
│ Docker Workers + Git Worktrees              │
│                                             │
│ Worker A → Agent → Branch A                 │
│ Worker B → Agent → Branch B                 │
│ Worker C → Agent → Branch C                 │
└─────────────────────────────────────────────┘

Data Flow

User creates task
       ↓
React frontend
       ↓
Fastify API
       ↓
Create task in SQLite via Prisma
       ↓
Create isolated Worker
       ↓
Docker container + Git worktree
       ↓
Load Agent Plugin
       ↓
AI Agent executes task
       ↓
Logs/status streamed via SSE
       ↓
GitHub commit / PR / CI
       ↓
Task status updated
       ↓
Dashboard updates in real time

🔒 Isolation Model

Isolation is a core part of TaskFleet because multiple AI agents may operate on the same repository concurrently.

Each worker receives:

A dedicated Docker container

A dedicated Git branch

A dedicated Git worktree

Its own execution environment

Per-container secrets

API keys and GitHub tokens should be injected through environment variables or a secrets manager rather than hard-coded or shared between workers.

🧰 Technology Stack

Layer

Technology

Purpose

Frontend

React + TypeScript

Web interface

Build Tool

Vite

Frontend development/build

Styling

Tailwind CSS

UI styling

Real-time

Server-Sent Events (SSE)

Live run progress streamed to the dashboard

Backend

Node.js + Fastify + TypeScript

REST API and orchestration

Database

SQLite (PostgreSQL-ready schema)

Tasks, runs, events and status history

ORM

Prisma

Database access and schema management

Validation

Zod

HTTP request and agent payload validation

Worker Isolation

Docker

Sandboxed task execution (planned per-task workers)

Git Isolation

Git worktrees

Collision-free parallel execution

Agent Interface

TypeScript adapter layer

Common agent contract

Agent Providers

OpenAI / Anthropic / offline stub

Pluggable LLM backends behind one adapter interface

VCS / CI

GitHub REST API + Webhooks

PR, CI, and review integration

CI

GitHub Actions

Automated project workflows

Secrets

Gitleaks

Secret scanning

Dependencies/Containers

Trivy

Security scanning

SAST

Semgrep

Static analysis

Authentication

GitHub OAuth

Team authentication

Deployment

Docker + Docker Compose

Single-image demo (API + built dashboard)

Testing

Vitest + Fastify `.inject()`

Unit and HTTP integration testing

📁 Project Structure

agent-orchestrator/
├── apps/
│   ├── api/
│   │   ├── prisma/schema.prisma        # Task, Run, RunEvent, RunArtifact
│   │   ├── src/
│   │   │   ├── agents/                 # Agent contract, registry, research + coding agents
│   │   │   ├── llm/                    # OpenAI / Anthropic / stub adapters (tool calling)
│   │   │   ├── runs/                   # RunStore, RunService lifecycle, test runner
│   │   │   ├── http/                   # Fastify routes, schemas, server
│   │   │   ├── security/               # Gitleaks / Semgrep / Trivy runner
│   │   │   ├── worktrees/              # Git worktree isolation + path jail
│   │   │   └── server.ts
│   │   └── test/                       # Vitest HTTP/unit/integration tests
│   └── web/
│       ├── src/
│       │   ├── components/             # layout, UI primitives, workspace panel
│       │   ├── hooks/                  # useQuery, useRunStream
│       │   ├── pages/                  # overview, tasks, runs, agents, security…
│       │   ├── api.ts                  # typed API client
│       │   └── index.css               # design tokens and themes
│       └── vite.config.ts
├── docs/implementation/M1.md           # M1 coding-agent milestone report
├── docker-compose.yml
├── .env.example
└── README.md

🔄 Example Workflow

A team lead creates three tasks:

1. Add rate limiting to the authentication endpoint
2. Write unit tests for the payment module
3. Fix a flaky checkout CI test

TaskFleet assigns the tasks to separate Claude-backed workers.

Task 1 ──→ Worker A ──→ Branch A ──→ PR
Task 2 ──→ Worker B ──→ Branch B ──→ PR
Task 3 ──→ Worker C ──→ Branch C ──→ CI

Workers execute concurrently inside isolated Docker containers.

If Tasks 1 and 2 pass CI and security scanning, they can move automatically toward Ready to Merge.

If Task 3 fails CI:

CI Failure
    ↓
Failure information
    ↓
Original Worker
    ↓
Agent receives feedback
    ↓
Agent attempts fix
    ↓
New commit
    ↓
CI runs again

The team can supervise the entire workflow from the run console without manually copying CI errors into an agent conversation.

🎯 Use Cases

Solo Developers

Run multiple independent tasks simultaneously instead of completing them sequentially.

Small Development Teams

Delegate well-scoped tasks such as:

Refactoring

Boilerplate generation

Test coverage

Database migrations

while humans focus on architecture and review.

Hackathons

Parallelize frontend, backend, and integration work when development time is limited.

Learning & Onboarding

Allow students or new developers to observe how an AI agent approaches a task through worker logs and diffs.

Security-Conscious Teams

Apply secret scanning, dependency scanning, and SAST checks to AI-generated code before merging.

🛠️ Getting Started

Requirements: Node.js 20+ (22 recommended), npm 10+, Git. Docker is optional.

```bash
npm install       # installs all workspaces and generates the Prisma client
npm run db:push   # creates apps/api/data/taskfleet.db from the Prisma schema
npm run dev       # API with hot reload on http://127.0.0.1:3000
npm run dev:web   # dashboard on http://localhost:5173 (run in a second terminal)
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3000`, so no frontend env var is needed for
local development. `VITE_API_URL` overrides the API origin:

```bash
VITE_API_URL=http://127.0.0.1:4000 npm run dev:web
```

The API does not emit CORS headers, so a cross-origin `VITE_API_URL` must be fronted by a proxy or
served from the same origin; the verified local path is the Vite proxy or the production build
served by the API.

Single-process demo (the API serves the built dashboard):

```bash
npm run build
npm start         # http://127.0.0.1:3000
```

Verification:

```bash
npm run typecheck   # API + web strict TypeScript
npm test            # API unit/HTTP integration suite
npm run build       # production web bundle
```

Last verified: `npm run typecheck` passes for both workspaces; `npm test` passes
12 files / 57 tests; `npm run build` produces the dashboard bundle.

Docker:

```bash
docker compose up --build   # http://localhost:3000
```

Configuration — copy `.env.example` to `apps/api/.env` (loaded automatically):

- `PORT` / `HOST` — HTTP port and bind address (default `3000` / `127.0.0.1`; use `0.0.0.0` in Docker)
- `DATABASE_URL` — SQLite location (default `file:./data/taskfleet.db`)
- `LLM_PROVIDER` — `stub` (default), `openai`, or `anthropic`. The stub cannot call
  tools, so coding runs require `openai` or `anthropic`
- `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` — provider credentials and optional overrides
- `GITHUB_TOKEN` / `GITHUB_REPOSITORY` — required to push branches and open PRs
- `GITHUB_WEBHOOK_SECRET` — enables `/webhooks/github` when set
- `GITHUB_BASE_BRANCH` / `GITHUB_REMOTE_URL` — PR target and optional push remote override
- `WORKTREES_ENABLED` / `WORKTREES_ROOT` — Git worktree isolation (default enabled)
- `WORKTREE_KEEP_ON_SUCCESS` / `WORKTREE_KEEP_ON_FAILURE` — worktree retention policy
- `AGENT_MAX_STEPS` / `AGENT_MAX_TOKENS` / `AGENT_MAX_TOOL_CALLS` — agent limits
- `AGENT_COMMAND_TIMEOUT_MS` / `AGENT_TEST_TIMEOUT_MS` — command and test timeouts
- `AGENT_RUN_TESTS` / `AGENT_REQUIRE_CHANGES` / `AGENT_TEST_COMMAND` — verification policy
- `MAX_CONCURRENT_RUNS` — maximum number of runs executing simultaneously (default: 3)
- `AGENT_COMMAND_ALLOWLIST` — comma-separated executables the agent may run (no shell)

### M2 Testing

M2 introduces the scheduler and lifecycle management. Tests verify:

- **Concurrency limits**: Three submitted runs with `MAX_CONCURRENT_RUNS=2` — exactly two execute simultaneously, third remains queued
- **Queue triggering**: Completion of a running run triggers the next queued run
- **Queued run cancellation**: Queued runs cancelled immediately via `POST /runs/:runId/cancel`
- **Running run cancellation**: Running runs cancelled via AbortSignal
- **Restart recovery**: Application restart marks orphaned running runs as failed, recovers queued runs
- **Duplicate prevention**: Submitting duplicate runs prevents re-execution
- **Scheduler error handling**: Edge cases with concurrency and queue management

See `docs/implementation/M2.md` for detailed test scenarios and expected results.
- `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` — identity used for agent commits
- `SECURITY_ENABLED` — enables `POST /security/scan`
- `VITE_API_URL` — optional frontend API origin (default `/api`, using the dev proxy or same-origin build)

API endpoints (all also available under the `/api` prefix for the dashboard):

- `GET /health` — liveness probe
- `GET /agents` — registered agents with per-agent run/success statistics
- `GET /agents/:agentId` — one agent with capabilities and recent runs (`404` when unknown)
- `GET /tasks` — task list with runs and latest run status
- `POST /tasks` `{ prompt, title?, agentId?, priority?, start? }` — create a task. Default
  `start: true` returns `202` with the task and a dispatched run; `start: false` returns `201`
  with `run: null` and leaves the task queued
- `GET /tasks/:taskId` — task with runs and persisted events
- `PATCH /tasks/:taskId` — update `title`, `prompt`, `priority`, `status`, or `agentId`
- `DELETE /tasks/:taskId` — delete a task and its runs/events
- `POST /tasks/:taskId/run` — dispatch a queued task and return `202` with the run
- `GET /runs` — recent runs (optional `limit`), including provider, model, tokens, and task
- `GET /runs/:runId` — run with branch/worktree/commit/PR fields, persisted events,
  artifacts (diff, changed files, test results, commit, PR), and the originating task prompt
- `GET /runs/:runId/events` — SSE stream; replays persisted events, then live events, with a 15s
  heartbeat. Event types: `run.started`, `workspace.created`, `workspace.removed`,
  `agent.started`, `agent.edit`, `agent.progress`, `test.started`, `test.completed`,
  `git.commit`, `git.push`, `github.pr.opened`, `github.pr.skipped`, `agent.completed`,
  `run.completed`, `agent.failed`, `run.failed`
- `POST /runs/:runId/cancel` — abort an active run; `409` if it already finished
- `GET /stats` — task/run totals, success rate, active runs, token usage
- `GET /activity` — recent task/run activity for the overview feed
- `GET /integrations` — provider, GitHub, webhook, worktree, and security configuration status
- `POST /research` `{ input, agentId? }` — synchronous compatibility endpoint
- `GET /worktrees` — worktrees when `WORKTREES_ENABLED=true`
- `GET /security/tools` / `POST /security/scan` — SecOps gate
- `POST /webhooks/github` — HMAC-verified GitHub webhook receiver (outside the `/api` prefix)

Example:

```bash
curl -X POST http://127.0.0.1:3000/api/tasks \
  -H 'content-type: application/json' \
  -d '{"prompt":"Explain git worktrees","agentId":"research-agent","priority":"high"}'

curl -N http://127.0.0.1:3000/api/runs/<runId>/events
```

✅ Current Implementation Status

Implemented and covered by tests:

- npm workspaces monorepo: `apps/api` + `apps/web`
- Fastify 5 API in strict TypeScript (native ESM) with Zod-validated inputs and outputs
- Vendor-neutral `Agent` contract, `AgentRegistry`, `ResearchAgent`, and a real
  `CodingAgent` with native tool calling
- Real LLM adapters for **OpenAI-compatible** and **Anthropic** APIs, including tool
  calling and cancellation, plus a deterministic offline `stub` provider (default)
- Prisma 7 + SQLite persistence for `Task`, `Run`, `RunEvent`, and `RunArtifact`,
  including task priority, run token usage, Git metadata, and evidence artifacts
- Full task CRUD and lifecycle: create queued or dispatch immediately, edit, re-run, delete with cascading runs/events
- Background task execution with ordered, persisted lifecycle events
- SSE streaming per run with replay, dedupe, reconnect handling, heartbeats, and server-side close on terminal events
- Per-run Git worktrees (`taskfleet/<runId>`) with path-jailed file tools, allowlisted
  commands, automatic tests, real diffs, commits, pushes, and GitHub PRs
- Run cancellation that aborts the model loop and kills child processes
- React 19 + Vite + Tailwind 4 developer console: overview, tasks, task detail, runs, run detail, agents, agent detail, security, and integrations
- Workspace panel with branch, worktree, changed files, unified diff, test results,
  commit SHA, and PR link; compact workspace summary on task detail
- Centralized typed API client (`VITE_API_URL`), shared query hook with loading/error/stale states, toasts, confirmations, keyboard-accessible dialogs, light/dark themes
- Single-process production mode: the API serves the built dashboard
- GitHub webhook verification/status mapping and a Pull Request client
- SecOps scanner runner for Gitleaks, Semgrep, and Trivy (graceful when a tool is absent)
- GitHub Actions CI, Dockerfile, Docker Compose, `.env.example`

Known limitations: agent isolation is filesystem/Git-level, not a container sandbox;
live coding and real PR creation require `LLM_API_KEY` and GitHub credentials; worktrees
are retained by default. See [`docs/implementation/M1.md`](docs/implementation/M1.md).

Verified end-to-end in this environment:

- Real HTTP CRUD: create queued (`201`, no run) → fetch → `PATCH` → validation error (`400`) → dispatch (`202`) → six SSE events → persisted completed run with provider/model/output/prompt
- Dashboard metrics, activity, agent stats, integrations, worktrees, and security endpoints all served from SQLite
- UI drive-through in headless Chrome: create and run, run timeline, edit, queued create, delete queued task, delete executed task with cascade, dashboard reflects database
- Offline behavior: API outage renders explicit error states with retry plus a stale-data notice
- Persistence across API restart; unknown agent/run return `404`
- Real Trivy scan passes with `SECURITY_ENABLED=true`; scan returns `503` when disabled

Partially implemented / needs external prerequisites:

- Worktree isolation exists as a tested service; it is not yet wired into task execution because the current agent does not modify files.
- GitHub PR creation needs `GITHUB_TOKEN` + `GITHUB_REPOSITORY`; webhooks need a public URL and `GITHUB_WEBHOOK_SECRET`. The webhook handler is verified, but no live GitHub delivery was exercised here.
- Live OpenAI/Anthropic runs require `LLM_API_KEY`; all runs in this environment used the `stub` provider, which the UI labels explicitly.
- Gitleaks and Semgrep were unavailable locally; only a real Trivy run was verified. Missing tools are reported instead of simulated.
- The Docker image was authored but not built here (no Docker daemon available).

Not implemented yet: **M3 security scanning and PR security gate** implemented. per-task Docker worker isolation, GitHub OAuth, coding agents that edit repositories and push branches, task decomposition/scheduling, and analytics.

🗺️ Development Roadmap

The project is planned as a 16-week incremental build using two-week Agile sprints.

Phase 1 — Foundations

Weeks 1–3

Repository setup

Project CI pipeline

Database schema

Basic React application

Fastify API skeleton

Phase 2 — Core Worker Execution

Weeks 4–7

Docker-based worker creation

Git worktree isolation

Initial agent plugin

Claude integration

End-to-end task execution

Diff generation

Phase 3 — Plugin Interface & Run Console

Weeks 8–10

Generalize agent interface

Add support for another agent

Build live run console

SSE-driven task and run status

Phase 4 — GitHub Integration

Weeks 11–13

Pull request creation

GitHub webhook integration

CI status tracking

Review comment feedback loop

Phase 5 — SecOps

Weeks 14–15

Secret scanning

Dependency/container scanning

Basic SAST

Security gate for merge readiness

Phase 6 — Hardening & Demo

Week 16

Testing

Bug fixing

Documentation

Final demonstration

Project report preparation

🧪 Testing Strategy

TaskFleet uses multiple levels of automated testing:

- Unit tests for orchestration and run lifecycle logic
- HTTP integration tests through Fastify `.inject()` against a temporary SQLite database
- Registry/plugin tests with controlled stub agents
- Git worktree integration tests against a real temporary repository
- Webhook verification and security runner tests
- Manual end-to-end verification of the UI against the real API, including SSE replay and persistence

The project also follows short-lived feature branches and mandatory pull-request review within the development team.

👥 Team Responsibilities

Role

Responsibilities

Frontend & UX Lead

React/TypeScript dashboard, task creation and editing, run detail view, SSE client, UI polish

Backend & Orchestration Lead

Fastify API, task/run lifecycle, SQLite/Prisma, task breakdown, SSE server

Agent Integration & Isolation Lead

Docker workers, Git worktrees, plugin interface, Claude integration, additional agent support

DevOps, GitHub Integration & SecOps Lead

GitHub OAuth, PR/CI/webhooks, security scanning, deployment, project CI

All team members contribute to testing, documentation, integration, and the final report/demo.

⚙️ Development Principles

TaskFleet follows these core engineering principles:

Isolation first — agents should not interfere with one another.

Plugin-based agents — the orchestration core should not depend on one AI vendor.

Real-time visibility — task state should reflect actual Git/CI/PR activity.

Human supervision — AI agents execute tasks, while humans retain review and merge control.

Security by default — AI-generated code should pass automated security gates.

Incremental development — build a stable core first, then add integrations.

🔮 Future Scope

The architecture leaves room for additional coding-agent integrations, richer orchestration, and expanded DevOps automation.

Potential future improvements include:

More AI agent providers

More sophisticated task decomposition

Advanced worker scheduling

Better resource management

Expanded security policies

More detailed analytics and observability

Additional Git providers

Production-grade secrets management

More advanced CI/CD integrations

These are potential extensions rather than features confirmed as part of the current semester scope.

📌 Project Status

Status: In Development — end-to-end demo working
Project Type: Semester Group Project
Duration: 16 weeks
Focus: Multi-Agent AI + DevOps + GitHub Automation + Security

Implemented: npm workspaces monorepo, Fastify API, typed agent contract + registry, Zod contracts,
OpenAI/Anthropic/stub LLM adapters, Prisma persistence, SSE progress stream, full task CRUD and
re-run lifecycle, and a React developer console covering overview, tasks, runs, agents, security,
and integrations. Includes Git worktree isolation, GitHub webhook/PR integration, SecOps scanner
runner, Docker packaging, CI, and tests.

Remaining: per-task Docker worker execution, GitHub OAuth, a coding agent that edits and pushes
repositories, analytics. Docker image build and live GitHub/LLM/security-tool runs require
credentials or a Docker daemon not available here. **M2 scheduler and lifecycle management
(concurrency limits, queued runs, cancellation, restart recovery) are implemented and testable.**

📄 Project Reference

TaskFleet is conceptually inspired by Agent Orchestrator (AO) and adapts the multi-agent coding orchestration concept into a browser-based, team-oriented platform with Docker worker isolation, Git worktrees, a plugin architecture, real-time run monitoring, GitHub integration, and a SecOps gate.
