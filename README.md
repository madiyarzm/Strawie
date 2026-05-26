# Strawie — Collaborative Coding Classroom

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Yjs](https://img.shields.io/badge/Yjs-CRDT-orange?style=flat)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

> A real-time collaborative platform for teaching Python. Teachers run classrooms and assignments; students write, run, and submit code straight in the browser — with live multi-user editing, sandboxed execution, AI hints, and gamified progress.

**Live:** [strawie.dev](https://strawie.dev)

---

## What it does

| Area | Highlights |
|---|---|
| **Teaching** | Groups with invite codes → classrooms → assignments (starter code, hidden tests, deadlines). Teachers see every submission and leave inline feedback. |
| **Coding** | Multi-file CodeMirror editor, interactive Python runner with live stdin, pass/fail test results. |
| **Collaboration** | Conflict-free real-time co-editing and a shared drawing canvas for sketching schemes — same CRDT engine behind both. |
| **Learning loop** | XP and levels, unlockable cosmetics, AI hints (Claude) after repeated failures, a personal solo **Workspace** for free practice. |
| **Roles** | `student`, `teacher`, `admin` — capabilities enforced server-side; admins can preview the app as either role. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend — React 19 · Vite · TypeScript · Tailwind          │
│  CodeMirror editor · Yjs collab · drawing canvas · XP UI     │
└───────────────┬──────────────────────────────┬───────────────┘
                │ REST (HTTP)                  │ WebSocket
┌───────────────▼──────────────────────────────▼───────────────┐
│  Backend — FastAPI (Python 3.12)                             │
│  Routes → Services → Models / Schemas   (layered, DI)        │
│  ├─ /api/v1/*           auth, groups, classrooms, submissions │
│  ├─ /ws/collab/{room}   Yjs binary relay (stateless)         │
│  └─ /ws/sandbox/run     streaming, interactive execution     │
└──────┬─────────────────┬────────────────────┬────────────────┘
       │                 │                    │
┌──────▼──────┐  ┌────────▼────────┐  ┌────────▼─────────┐
│ PostgreSQL  │  │ Sandbox         │  │ Collab manager   │
│ (Supabase)  │  │ subprocess /    │  │ in-memory room   │
│ SQLAlchemy  │  │ Docker /        │  │ → socket registry│
│ + Alembic   │  │ Pyodide (WASM)  │  │                  │
└─────────────┘  └─────────────────┘  └──────────────────┘
```

---

## Key architectural decisions

### 1. Defense-in-depth code execution
Student code never runs in the app process. Three isolation strategies share one `SandboxExecutor` interface:
- **Subprocess (default)** — stripped builtins (`open`, `exec`, `eval`…), a module allowlist, an **env-var allowlist** so secrets are unreachable from inside the sandbox, plus wall-clock and output caps.
- **Docker (optional )** — `--network=none`, read-only FS, memory/PID limits, non-root user.
- **Pyodide (in-browser WASM)** — graded submissions run client-side, fully off the server.

A streaming WebSocket sandbox (`/ws/sandbox/run`) adds **interactive stdin** — programs pause on `input()` and the user types in the terminal, VS Code style.

### 2. Real-time collaboration via CRDT
Editing and the drawing canvas both run on **Yjs**, a Conflict-free Replicated Data Type. The server is a **stateless binary relay** — it broadcasts opaque updates between peers in a room and never interprets them; conflict resolution happens entirely client-side. A separate awareness channel carries cursors, names, and role colors. Room access is authorized before a socket joins.

### 3. Layered service architecture
`Routes → Services → Models/Schemas`, with dependencies (DB session, current user) injected via FastAPI's DI. Routes only validate and delegate; all domain logic lives in services. Each layer is independently testable and swappable (the sandbox backend is a single config flag).

### 4. Cookie-based auth + locked roles
Google OAuth issues a JWT stored in an **httpOnly cookie** (not `localStorage`), so it's invisible to client-side JS. Role is chosen once and **locked** server-side — there's no path to escalate from student to teacher later. Submission and sandbox endpoints are rate-limited per IP/user.

---

## Tech stack

| Layer | Stack |
|---|---|
| **Backend** | Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic, python-jose (JWT) |
| **Frontend** | React 19, TypeScript, Vite 7, Tailwind CSS 3, CodeMirror 6, Yjs |
| **Database** | PostgreSQL (Supabase in production) |
| **AI** | Claude Haiku — context-aware hints |
| **Infra** | Docker (multi-stage build), Northflank, GitHub Actions CI/CD |

---

## Project structure

```
app/                  FastAPI backend
├── api/v1/            REST route handlers
├── api/ws_*.py        WebSocket endpoints (collab, interactive sandbox)
├── services/          business logic layer
├── sandbox/           subprocess + Docker executors
├── models/  schemas/  SQLAlchemy ORM + Pydantic contracts
└── core/              auth, security, rate limiting, room ACL
frontend-vite/src/     React app (editor, dashboard, collab hooks)
alembic/versions/      database migrations
```

---

## Getting started

**Prerequisites:** Python 3.12, Node 20+, PostgreSQL.

```bash
# Backend
cp .env.example .env          # set DATABASE_URL, Google OAuth, SECRET_KEY
alembic upgrade head          # apply database migrations
uvicorn app.main:app --reload # → http://localhost:8000

# Frontend
cd frontend-vite
npm install
npm run dev                   # → http://localhost:5173 (proxies /api + /ws)
```

For production, the multi-stage `Dockerfile` builds the frontend, runs migrations, and serves both from a single container.
