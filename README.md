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

Live Kanban Board — real-time task state based on Git, CI, and PR signals.

Feedback Loop — CI failures and review comments can be routed back to the responsible worker.

SecOps Gate — automated security checks before code reaches the merge-ready state.

✨ Key Features

🤖 Multi-Agent Task Execution

Create coding tasks using natural language and assign them to an AI coding agent.

⚡ Parallel Execution

Multiple workers can execute different tasks concurrently without overwriting each other's work.

🌿 Git Worktree Isolation

Every worker receives its own Git branch and worktree, preventing file-level conflicts between agents.

🐳 Docker-Based Worker Isolation

Workers execute inside separate Docker containers to reduce the impact of runaway or malicious agent processes.

🔌 Agent Plugin Architecture

TaskFleet uses a common adapter interface so different agents can be integrated without changing the orchestration core.

Planned/targeted integrations include:

Anthropic Claude API

OpenAI-compatible APIs

CLI-based coding agents

Other agents implementing the TaskFleet adapter contract

📊 Live Kanban Dashboard

The dashboard tracks states such as:

Working

Needs Attention

In Review

Ready to Merge

Updates are delivered through WebSockets, eliminating the need for manual page refreshes.

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
│  Task Creation │ Kanban │ Worker Details   │
└──────────────────────┬──────────────────────┘
                       │
                 REST + WebSocket
                       │
┌──────────────────────▼──────────────────────┐
│             Orchestration Layer             │
│         Node.js + Fastify + TypeScript      │
│                                             │
│ Task Lifecycle │ Sessions │ Orchestrator    │
│ WebSocket Server │ GitHub Integration       │
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
Express API
       ↓
Create task in PostgreSQL
       ↓
Create isolated Worker
       ↓
Docker container + Git worktree
       ↓
Load Agent Plugin
       ↓
AI Agent executes task
       ↓
Logs/status streamed via WebSocket
       ↓
GitHub commit / PR / CI
       ↓
Task status updated
       ↓
Kanban board updates in real time

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

Live run progress streamed to the Kanban

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

📁 Suggested Project Structure

taskfleet/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── orchestrator/
│   │   ├── workers/
│   │   ├── plugins/
│   │   ├── github/
│   │   └── websocket/
│   ├── prisma/
│   └── package.json
│
├── workers/
│   ├── docker/
│   ├── plugins/
│   └── runtime/
│
├── security/
│   ├── gitleaks/
│   ├── trivy/
│   └── semgrep/
│
├── docker-compose.yml
├── .env.example
└── README.md

The structure above is a suggested implementation structure based on the project's architecture; the report does not specify a finalized repository directory layout.

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

The team can supervise the entire workflow from the Kanban board without manually copying CI errors into an agent conversation.

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
npm run dev:web   # dashboard on http://127.0.0.1:5173 (run in a second terminal)
```

Single-process demo (the API serves the built dashboard):

```bash
npm run build
npm start         # http://127.0.0.1:3000
```

Verification:

```bash
npm run typecheck
npm test
```

Docker:

```bash
docker compose up --build   # http://localhost:3000
```

Configuration — copy `.env.example` to `apps/api/.env` (loaded automatically):

- `PORT` / `HOST` — HTTP port and bind address (default `3000` / `127.0.0.1`; use `0.0.0.0` in Docker)
- `DATABASE_URL` — SQLite location (default `file:./data/taskfleet.db`)
- `LLM_PROVIDER` — `stub` (default), `openai`, or `anthropic`
- `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` — provider credentials and optional overrides
- `GITHUB_WEBHOOK_SECRET` — enables `/webhooks/github` when set
- `WORKTREES_ENABLED` / `WORKTREES_ROOT` — Git worktree isolation
- `SECURITY_ENABLED` — enables `POST /security/scan`

API endpoints (all also available under the `/api` prefix for the dashboard):

- `GET /health` — liveness probe
- `GET /agents` — registered agents and capabilities
- `POST /tasks` `{ prompt, title?, agentId? }` — create a task, returns `202` with the task and run
- `GET /tasks` — task list with runs (Kanban data)
- `GET /tasks/:taskId` — task with runs and persisted events
- `GET /runs/:runId` — run with persisted events
- `GET /runs/:runId/events` — SSE stream (`run.started`, `run.progress`, `run.completed`, `run.failed`)
- `POST /research` `{ input, agentId? }` — synchronous compatibility endpoint
- `GET /worktrees` — worktrees when `WORKTREES_ENABLED=true`
- `GET /security/tools` / `POST /security/scan` — SecOps gate
- `POST /webhooks/github` — HMAC-verified GitHub webhook receiver

Example:

```bash
curl -X POST http://127.0.0.1:3000/api/tasks \
  -H 'content-type: application/json' \
  -d '{"prompt":"Explain git worktrees","agentId":"research-agent"}'

curl -N http://127.0.0.1:3000/api/runs/<runId>/events
```

✅ Current Implementation Status

Implemented and covered by tests:

- npm workspaces monorepo: `apps/api` + `apps/web`
- Fastify 5 API in strict TypeScript (native ESM) with Zod-validated inputs and outputs
- Vendor-neutral `Agent` contract, `AgentRegistry`, and a `ResearchAgent`
- Real LLM adapters for **OpenAI-compatible** and **Anthropic** APIs, plus a deterministic offline `stub` provider (default)
- Prisma 7 + SQLite persistence for `Task`, `Run`, and `RunEvent`
- Background task execution with ordered, persisted progress events
- SSE streaming per run with replay of persisted events and heartbeats
- React + Vite + Tailwind Kanban dashboard with live progress and a run detail panel
- Single-process production mode: the API serves the built dashboard
- Git worktree service (per-task branch + worktree) with real Git integration tests
- GitHub webhook verification/status mapping and a Pull Request client
- SecOps scanner runner for Gitleaks, Semgrep, and Trivy (graceful when a tool is absent)
- GitHub Actions CI, Dockerfile, Docker Compose, `.env.example`

Partially implemented / needs external prerequisites:

- Worktree isolation exists as a tested service; it is not yet wired into task execution because the current agent does not modify files.
- GitHub PR creation needs `GITHUB_TOKEN` + `GITHUB_REPOSITORY`; webhooks need a public URL and `GITHUB_WEBHOOK_SECRET`.
- Security scanning needs the external binaries installed; it runs but has not been executed against Gitleaks/Semgrep/Trivy in this environment.
- The Docker image was authored but not built here (no Docker daemon available).

Not implemented yet: per-task Docker worker isolation, GitHub OAuth, coding agents that edit repositories and push branches, task decomposition/scheduling, and analytics.

🗺️ Development Roadmap

The project is planned as a 16-week incremental build using two-week Agile sprints.

Phase 1 — Foundations

Weeks 1–3

Repository setup

Project CI pipeline

Database schema

Basic React application

Express API skeleton

Phase 2 — Core Worker Execution

Weeks 4–7

Docker-based worker creation

Git worktree isolation

Initial agent plugin

Claude integration

End-to-end task execution

Diff generation

Phase 3 — Plugin Interface & Kanban

Weeks 8–10

Generalize agent interface

Add support for another agent

Build live Kanban board

WebSocket-driven task status

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

TaskFleet plans to use multiple levels of automated testing:

Unit tests for orchestration logic

Integration tests for the plugin interface

Mock agents for controlled plugin testing

Backend API tests

Smoke tests covering the task-to-PR workflow

The project also follows short-lived feature branches and mandatory pull-request review within the development team.

👥 Team Responsibilities

Role

Responsibilities

Frontend & UX Lead

React/TypeScript Kanban UI, task creation, worker detail view, WebSocket client, UI polish

Backend & Orchestration Lead

Express API, task/worker lifecycle, PostgreSQL/Prisma, task breakdown, WebSocket server

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
OpenAI/Anthropic/stub LLM adapters, Prisma persistence and SSE progress stream, React Kanban
dashboard, Git worktree isolation, GitHub webhook/PR integration, SecOps scanner runner, Docker
packaging, CI, and tests.

Remaining: per-task Docker worker execution, GitHub OAuth, a coding agent that edits and pushes
repositories, task decomposition/scheduling, and analytics. Docker image build and live
GitHub/LLM/security-tool runs require credentials or a Docker daemon not available here.

📄 Project Reference

TaskFleet is conceptually inspired by Agent Orchestrator (AO) and adapts the multi-agent coding orchestration concept into a browser-based, team-oriented platform with Docker worker isolation, Git worktrees, a plugin architecture, real-time Kanban monitoring, GitHub integration, and a SecOps gate.
