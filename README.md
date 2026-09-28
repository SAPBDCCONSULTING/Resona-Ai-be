# Resona AI — Backend API

Standalone NestJS API. Own git repo — own branches (usually `main`).

## Setup

```bash
cp .env.example .env
docker compose up -d --build
# or infra only + local API:
# docker compose up -d mongo redis && npm install && npm run dev
```

API: http://localhost:4000/api/health

### Seed logins (password `password123`)

| Email | Role | Notes |
|-------|------|--------|
| `admin@resonaai.local` | Admin | Full permissions |
| `employee@resonaai.local` | Employee | Employee app |
| `analyst@resonaai.local` | Analyst | `sessions:read` only — 403 on write |

### Useful commands

```bash
npm test                          # unit (incl. RBAC 403)
k6 run k6/smoke.js                # /health + /sessions smoke
```

See `docs/ADR-001-tech-stack.md` and workspace `../ROADMAP.md`.
