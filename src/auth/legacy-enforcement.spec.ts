import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Regression guard for Stage 4: the legacy `@RequirePermissions('x:y')` enforcement must not
 * change. This pins how many routes each controller gates with each legacy key. If you
 * deliberately change enforcement (Stage 6), update this table in the same reviewed change.
 *
 * (Controllers are scanned as text because importing the session schemas under ts-jest's
 * isolatedModules setting fails independently of this feature.)
 */
const SRC = join(__dirname, '..');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return controllerFiles(p);
    return name.endsWith('.controller.ts') ? [p] : [];
  });
}

function scan(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const file of controllerFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const counts: Record<string, number> = {};
    for (const m of text.matchAll(/@RequirePermissions\(([^)]*)\)/g)) {
      for (const k of m[1].matchAll(/'([^']+)'/g)) {
        counts[k[1]] = (counts[k[1]] ?? 0) + 1;
      }
    }
    if (Object.keys(counts).length) {
      out[relative(SRC, file).replace(/\\/g, '/')] = counts;
    }
  }
  return out;
}

describe('legacy permission enforcement is unchanged', () => {
  it('pins @RequirePermissions usage per controller', () => {
    expect(scan()).toEqual({
      'ai/ai.controller.ts': { 'ai:use': 4 },
      'campaigns/campaigns.controller.ts': {
        'campaigns:read': 2,
        'campaigns:write': 3,
      },
      'contacts/contacts.controller.ts': {
        'contacts:import': 1,
        'contacts:read': 4,
        'contacts:write': 8,
      },
      'conversations/conversations.controller.ts': {
        'responses:write': 2,
        'sessions:read': 1,
      },
      'org/org.controller.ts': { 'settings:read': 1, 'settings:write': 1 },
      'responses/responses.controller.ts': {
        'responses:write': 1,
        'sessions:read': 2,
      },
      // 'roles:read' x1 (GET /roles, pre-existing) + GET /roles/profiles (new);
      // 'roles:write' x1 = PATCH /roles/profiles/:profileKey/grants (new).
      // Stage 5 adds GET /roles/custom (roles:read) and POST/PATCH/DELETE /roles/custom (roles:write).
      'roles/roles.controller.ts': { 'roles:read': 3, 'roles:write': 4 },
      'sessions/sessions.controller.ts': {
        'sessions:launch': 1,
        'sessions:read': 2,
        'sessions:write': 2,
      },
      // Session templates add GET /session-templates/:id (read), PATCH /session-templates/:id and
      // POST /session-templates/:id/duplicate (write).
      'templates/templates.controller.ts': {
        'templates:read': 3,
        'templates:write': 3,
      },
      // Stage 5 adds GET /users/assignable-roles (users:write); the other two are unchanged.
      'users/users.controller.ts': { 'users:read': 1, 'users:write': 2 },
    });
  });

  it('never uses dot-style (granular) keys in RequirePermissions', () => {
    for (const counts of Object.values(scan())) {
      for (const key of Object.keys(counts)) expect(key).toContain(':');
    }
  });
});
