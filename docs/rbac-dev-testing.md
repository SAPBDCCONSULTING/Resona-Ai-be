# Testing every role locally (development only)

## What exists

Sign-in is the normal email + password flow (`POST /api/auth/login` → JWT; the dashboard stores the
token, shows who is signed in in the sidebar, and has a **Sign out** button). The dashboard no
longer signs anyone in automatically: with no valid session it shows the login page.

To switch accounts: **Sign out**, then sign in as someone else. There is deliberately no
"switch role" dropdown or impersonation.

## Create the test accounts

The existing application seed only creates `admin@resonaai.local` (Admin) and an Employee/Analyst
in the `resonaai` organization. For a repeatable test of **all four** roles use the dev-fixture CLI.
It creates a separate organization (`rbac-dev`) so no real user or role is touched:

```powershell
cd resona-ai-be
$env:MONGODB_URI = "mongodb://127.0.0.1:27017/resona"      # local dev database only
$env:DEV_TEST_PASSWORD = "choose-a-12+-char-password"       # or omit to get a generated one, printed once
npm run seed:dev-users
```

| Email | Role | Purpose |
|---|---|---|
| `owner.test@rbac-dev.local` | Owner | full control; creates roles, delegates to Admin |
| `admin.test@rbac-dev.local` | Admin | legacy admin; can create roles only after the Owner delegates grants |
| `analyst.test@rbac-dev.local` | Analyst | read-only dashboards |
| `employee.test@rbac-dev.local` | Employee | participant; no administration |
| `custom.test@rbac-dev.local` | Employee (until you assign a custom role) | receives the custom role in the demo |

Safety: it refuses when `NODE_ENV=production` or the database host is not local (`localhost`,
`127.0.0.1`, `mongo`; `--allow-remote` is for a non-production database you own, and never overrides
production). No password is hardcoded. Re-running changes nothing; `-- --reset-passwords` re-sets
the five test passwords. The Owner is made through the same audited bootstrap routine as
`npm run rbac:bootstrap-owner`. There is no HTTP route that creates users or Owners.

If you run the API in Docker, rebuild it first (`docker compose build api && docker compose up -d api`)
so it contains the current code.

## Manager demo (about 5 minutes)

1. Sign in as `owner.test@rbac-dev.local`. The sidebar shows the name and an **Owner** badge.
2. Settings → Roles & Permissions → **Create Role** (enabled). Name "Directory Viewer", a description,
   tick **View users** and **View roles**, **Create role**. The *What this role can actually do* panel
   shows both under "Takes effect now", with the exact API routes they unlock.
   Also tick e.g. **Create contacts**: it is labelled **stored only** — saved, but it grants nothing.
3. Settings → User Management → set `custom.test` to **Directory Viewer (custom)**. Refresh the page; it persists.
4. **Sign out**, sign in as `custom.test@rbac-dev.local`. Sidebar shows *Directory Viewer*.
   The user list and role list load. User Management has no role dropdown, and Create Role is disabled
   with a reason.
5. Direct API denial (replace `<token>` with the value of `pf_token` from the browser's local storage):
   `curl -X POST http://localhost:4000/api/roles/custom -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"name\":\"X\",\"description\":\"d\",\"grants\":[\"users.read\"]}"` → **403**.
6. Sign back in as the Owner, edit *Directory Viewer*, untick **View users**, Save.
7. Return to the `custom.test` session (no re-login needed) and reload Users → access is denied on the
   very next request; the identity badge is unchanged but the permissions come from the server.
8. Optional: as the Owner open **Admin** → delegate "Create roles" + the grants Admins may use → Save;
   then sign in as `admin.test` and Create Role becomes available, limited to exactly those grants.
