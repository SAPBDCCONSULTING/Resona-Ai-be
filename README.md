# Resona AI — Backend API

Standalone NestJS API. Own git repo — own branches (usually `main`).

## Setup

```bash
docker compose up -d

cat > .env <<'EOF'
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/resona
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=dev-access-secret-change-me
JWT_REFRESH_SECRET=dev-refresh-secret-change-me
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
EOF

npm install
npm run dev
```

API: http://localhost:4000/api/health

Seed login: `admin@acme.local` / `password123`
