# Strawie

Live programming lessons for tutors and schools. Teach on a shared page, send everyone to their own copy, and give homework that checks itself, all in the browser.

**[strawie.dev](https://strawie.dev)** · [Try the demo](https://strawie.dev/demo)

## Features

- **Groups with a schedule.** Set class days and times, then share one invite link.
- **Live lesson pages.** Notes and runnable Python on one page, edited together in real time.
- **Together / Solo.** One click gives every student their own copy. The teacher sees all of them and can jump in.
- **Whiteboard.** Shapes, arrows and text on a shared canvas.
- **Homework.** Same task for everyone, editable per student, private to student and teacher. Teacher-written tests (function calls or input/output, optionally hidden) run on submit.
- **Review.** Every submission in one place, with feedback.
- **Workspace.** A private notebook for each user.
- **XP and streaks**, English and Russian UI.

## How it works

```
React + Vite ── REST ──────► FastAPI ──► PostgreSQL
     │                          ▲
     └──── WebSocket (Yjs) ─────┘   rooms saved per lesson / student
Python runs in the browser (Pyodide in a Web Worker)
```

- **No code runs on the server.** Python runs client-side in Pyodide, inside a Web Worker. The loader is pinned by SHA-384. `input()` and Stop work through `SharedArrayBuffer`, enabled by COOP/COEP headers. Tests are graded in the browser, and the server only stores the results.
- **Real-time editing with CRDTs.** Pages and whiteboards are Yjs documents. The server relays updates, saves each room to Postgres, and seeds personal copies (Solo, homework) from their source page on first open. Access is checked per room before a socket joins.
- **Auth.** Google sign-in. The JWT is kept in an httpOnly cookie, and the role is locked once chosen.

## Stack

| | |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, pycrdt |
| Frontend | React 19, TypeScript, Vite, Tailwind, CodeMirror 6, Yjs |
| Runtime | Pyodide (WebAssembly) |
| Data | PostgreSQL |
| Deploy | Docker, GitHub Actions, Northflank |

## Development

Requires Python 3.12, Node 20+ and PostgreSQL.

```bash
cp .env.example .env            # DATABASE_URL, SECRET_KEY, Google OAuth
pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload   # :8000

cd frontend-vite && npm install
npm run dev                     # :5173, proxies /api and /ws
```

```bash
pytest                          # backend tests
cd frontend-vite && npx tsc --noEmit && npm run lint
```

Tests and `scripts/check_migrations.py` expect `DATABASE_URL` to point at a **throwaway** Postgres. CI starts one for them. Never point them at real data.

## Layout

```
app/             FastAPI: api/ routes, services/, models/, schemas/, core/ (auth, rooms, ACL)
alembic/         migrations
frontend-vite/   React app (src/lessons = groups, lessons, notebook, homework)
tests/           pytest
```

## License

[MIT](LICENSE)
