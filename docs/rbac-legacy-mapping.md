# Legacy → granular permission mapping (PROPOSAL — not implemented)

Status: **unapproved analysis, reserved for Stage 6.** Nothing in the codebase reads this table.

Two permission models coexist deliberately:

| | Legacy | Granular ("grants") |
|---|---|---|
| Format | `resource:action` (`roles:write`) | `resource.action` (`roles.update`) |
| Defined in | `shared/src/index.ts` → `PermissionKey` | `shared/src/permission-registry.ts` → `GRANT_REGISTRY` |
| Stored in | `roles.permissions` | `role_profiles.grants` |
| In the JWT | yes (8h lifetime) | no |
| **Enforced** | **yes — `@RequirePermissions` + `PermissionsGuard`** | **no (configuration only)** |

Stage 4 did not change effective access. `src/auth/legacy-enforcement.spec.ts` pins the legacy
enforcement so any change to it has to be deliberate.

## Mapping classes

Derived by reading every controller, not from the names. Verified against the route table on
2026-10-17; 6 of 23 legacy keys are exact.

### Exact (1:1, safe to map)

| Legacy | Enforced at | Granular |
|---|---|---|
| `users:read` | `GET /users` | `users.read` |
| `roles:read` | `GET /roles`, `GET /roles/profiles` | `roles.read` |
| `contacts:import` | `POST /contacts/import` | `contacts.import` |
| `sessions:launch` | `POST /sessions/:id/launch` | `sessions.launch` |
| `templates:read` | `GET /report-templates`, `GET /session-templates` | `templates.read` |
| `ai:use` | 4 × `/ai/*` | `ai.use` |

### Partial (one legacy key covers several granular actions — widening risk)

| Legacy | Enforced at | Granular candidates | Problem |
|---|---|---|---|
| `contacts:read` | contact/group reads **and `GET /contacts/export`** | `contacts.read` (+ `contacts.export`?) | Export is currently open to any reader. Mapping `contacts.export` separately **removes** access; not mapping it leaves export ungated. |
| `contacts:write` | 8 routes: contact create/update/**delete**, group create/update/delete/members | `contacts.create`, `contacts.update` | No granular key for delete or group management. |
| `sessions:write` | `POST /sessions/draft`, `PATCH /sessions/:id` | `sessions.create`, `sessions.update` | Splitting one key into two. |
| `templates:write` | `POST /session-templates` only | `templates.create` | `templates.update` / `.publish` have no route. |

### Ambiguous (needs a product decision)

| Legacy | Enforced at | Question |
|---|---|---|
| `sessions:read` | session list/get, `GET /me/assignments`, own responses, `conversations/mine` | Also used by employee-facing flows; one granular key may not fit both. |
| `users:write` | `PATCH /users/:id/role` **only** | Is this `roles.assign` or `users.update`? They are different permissions. |
| `roles:write` | `PATCH /roles/profiles/:key/grants` (added in Stage 4) | Spec splits into `roles.create/update/assign/delete`. |
| `campaigns:read` / `campaigns:write` | campaign list/get; create/update/launch | **Is "campaign" the same product concept as "program"?** No evidence found in the code; the `campaigns` collection and `programs.*` keys are unrelated as far as the repo shows. **Do not assume equivalence.** Launch also has no granular key. |
| `settings:read` / `settings:write` | `GET /org`, `PATCH /org` (profile, branding, guardrails, retention) | Closest are `org.read` / `org.update`, but the spec lists Settings & guardrails as a separate area with no confirmed keys. |

### Name-exact but never enforced (no route requires them)

`org:read`, `org:write`, `sessions:archive`, `reports:read`, `reports:export`.
Granting the matching granular key would be the **first** time these gate anything.

### Unmapped

| Legacy | Why |
|---|---|
| `responses:write` | Participant action (submit a response, conversation start/chat). Not an admin permission; the registry has no equivalent. |

### Granular keys with no legacy counterpart

`users.invite`, `users.deactivate`, `contacts.export` (as its own gate), `sessions.archive`
(unenforced), `programs.*` (unless campaigns = programs), `templates.update`, `templates.publish`,
`reports.*` (unenforced), `roles.create`, `roles.delete`, `org.update`.

### Gaps in the granular registry

No key for: deleting a contact, managing contact groups, launching a campaign/program, submitting
a response. These routes exist and are gated today.

## Before Stage 6

1. Confirm campaigns vs programs against the specification.
2. Decide each Partial/Ambiguous row — a migration must not widen or narrow access by accident.
3. Add the missing keys above, or accept the gaps explicitly.
4. Decide how the 8-hour JWT permission list is refreshed when grants change.
5. Confirm the `sensitivity` classifications in the registry (currently placeholders).
6. Owner now exists (see docs/rbac-owner-bootstrap.md): it is created only by the operator CLI and cannot be changed through the API. Custom roles are assignable but carry EMPTY legacy `permissions`, so assigning one grants no enforced access until Stage 6 decides how `grants` are enforced.

## Stage 6 — what is and is not enforced (implemented)

Scope was taken from the "Before Stage 6" list above; no separate Stage 6 specification exists in
the repository.

**Enforced now**

* **Fresh permissions per request.** `JwtStrategy.validate` re-reads the user, organization, role and
  permissions from the database on every request. The token only identifies the caller. A demoted,
  re-assigned or deleted user loses access immediately (item 4 above is resolved).
* **Custom roles are enforced through the six "Exact" rows only:** `users.read→users:read`,
  `roles.read→roles:read`, `contacts.import→contacts:import`, `sessions.launch→sessions:launch`,
  `templates.read→templates:read`, `ai.use→ai:use` (`EXACT_GRANT_TO_LEGACY` in the shared registry).
  A custom role stores no legacy permissions; its effective ones are derived at request time.
  Every other grant is stored configuration and confers nothing.
* **System roles (Owner, Admin, Analyst, Employee) are unchanged.** Their granular config does not
  narrow or widen their access. Narrowing Admin by unconfigured grants would lock out the real
  administrator, so that remains a product decision.

**Still open (deliberately not decided here)**

| Item | Decision needed |
|---|---|
| Partial rows (`contacts:*`, `sessions:write`, `templates:write`) | Split-or-keep; mapping any of them changes real access |
| `users:write`, `roles:write` | Which granular grants they correspond to; today custom roles can never hold them, so a custom role can never assign roles or edit roles |
| `campaigns:*` vs `programs.*` | Are they the same concept? |
| `settings:*` / `org.*` | Mapping |
| Enforcing grants on system roles | Whether configured Admin/Analyst grants should restrict their legacy access, and how an unconfigured role behaves |
| Unenforced legacy keys (`org:*`, `reports:*`, `sessions:archive`) | First enforcement would be new gating |
