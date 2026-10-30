# Owner / Admin bootstrap and role-creation authority

## The problem this solves

Creating a custom role needs two things: the legacy `roles:write` permission (the only thing the
API enforced) **and** the granular grants to delegate. The legacy Admin has `roles:write` but no
configured granular grants, no approved legacy→granular mapping exists, and Stage 4 forbids a role
editing its own profile. Nobody else holds `roles:write`, so nobody could ever give Admin any
grants and **Create Role was disabled for every real administrator**.

## Design

Follows the specification's Owner / Admin distinction.

| | Owner | Admin |
|---|---|---|
| Exists as | one role per organization, `roles.kind = 'owner'` | the existing legacy `Admin` role |
| Legacy permissions | every administrative key (`OWNER_LEGACY_PERMISSIONS`; omits only the participant-only `responses:write`) | unchanged |
| Granular grants | **all, inherently** (nothing to configure) | **only what an Owner explicitly configures** for the Admin profile |
| Created by | the operator CLI only | already exists |
| Can be assigned / edited / deleted through the API | **No** — by anyone, including the Owner | assignable by users with `users:write` within their authority |

* **Bootstrap = operator CLI, not an endpoint.** `npm run rbac:bootstrap-owner -- --org <slug> --email <email> --confirm`
  (or `node dist/cli/bootstrap-owner.js …` in a built image) needs direct database access
  (`MONGODB_URI`), so no frontend-supplied role, user or organization is ever trusted and there is
  nothing to attack over HTTP. It refuses if the organization already has an Owner, if the user is
  not in that organization, or if a non-system role merely *named* "Owner" exists. It writes an
  `owner.bootstrap` audit event naming the operator's OS account.
* **Admin is configured by the Owner**, through the existing Stage 4 endpoint
  (`PATCH /api/roles/profiles/admin/grants`). The Admin still cannot edit their own profile. Nothing
  is granted to Admin implicitly.
* **Role operations need the granular grant as well as `roles:write`:** `roles.create`,
  `roles.update`, `roles.delete` for custom roles, and `roles.assign` to hand out a custom role. A
  caller can still only grant/remove grants they hold themselves.
* **Last-Owner protection.** The API cannot change an Owner's role (`403`), cannot assign the Owner
  role, cannot edit/delete it as a custom role, and the database allows at most one Owner *role* per
  organization. Bootstrap refuses to add a second Owner. So the last Owner cannot be demoted or
  removed through the application.
* **Audit.** `rbac_audit_events` (append-only) records `owner.bootstrap`, `role.create`,
  `role.update`, `role.delete`, `user.role.assign` with actor, target and details.

## Legacy permission mapping — decisions

No new legacy→granular mapping is introduced. Specifically:

* `roles:write` is **not** treated as granting `roles.create/update/assign/delete`. It remains the
  coarse legacy gate to reach the endpoints; the granular grant is a second, independent check.
* The Owner's "all grants" is by role definition (spec: full control), not a mapping of legacy keys.
* `responses:write` is exempt from the role-authority comparison (participant action, unchanged
  from Stage 5).

## Steps to enable it on a real environment

1. Run the CLI for the person who should own the organization (they sign out and in again).
2. As that Owner: Settings → Roles & Permissions → **Admin** → choose the permissions Admins may
   delegate (e.g. “Create roles”, “View roles”, and the permissions they may put in custom roles) → Save.
3. Admins can now create custom roles within exactly that set.

## Not included (needs a product decision)

* **Ownership transfer** and demoting an Owner: no mechanism exists; today it is a manual operator
  action. A secure flow (current Owner initiates, target accepts, last Owner retained) needs a spec.
* Whether editing *any* profile's grants (Stage 4 endpoint) should itself be limited to what the
  editor can delegate. Today any `roles:write` holder who does not hold the profile can edit it;
  harmless while grants are configuration-only, but should be decided before Stage 6 enforcement.
