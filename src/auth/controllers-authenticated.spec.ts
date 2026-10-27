import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every controller must reject unauthenticated requests. This pins which ones are allowed not to
 * (auth: login/refresh are public and /me is guarded per route; health; one intentionally public
 * join-info route) so a new unguarded controller fails CI instead of shipping.
 */
const SRC = join(__dirname, '..');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return controllerFiles(p);
    return name.endsWith('.controller.ts') ? [p] : [];
  });
}

const NOT_CLASS_GUARDED = new Set([
  'auth/auth.controller.ts',
  'health/health.controller.ts',
]);

describe('controllers require authentication', () => {
  it('every controller class is behind JwtAuthGuard, except the pinned exceptions', () => {
    const unguarded: string[] = [];
    for (const file of controllerFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      const text = readFileSync(file, 'utf8');
      const classes = [
        ...text.matchAll(/((?:@\w+\([^)]*\)\s*)*)export class (\w+)/g),
      ];
      for (const [, decorators, name] of classes) {
        if (!decorators.includes('@Controller')) continue;
        if (decorators.includes('JwtAuthGuard')) continue;
        if (NOT_CLASS_GUARDED.has(rel)) continue;
        if (name === 'PublicSessionsController') continue; // documented public join info
        unguarded.push(`${rel}:${name}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('the auth controller guards /me individually and exposes only login/refresh publicly', () => {
    const text = readFileSync(join(SRC, 'auth/auth.controller.ts'), 'utf8');
    expect(text).toMatch(/@UseGuards\(JwtAuthGuard\)\s*@Get\('me'\)/);
    const publicRoutes = [
      ...text.matchAll(/@(Get|Post|Patch|Put|Delete)\('([^']*)'\)/g),
    ]
      .map((m) => m[2])
      .filter((p) => p !== 'me')
      .sort();
    expect(publicRoutes).toEqual(['login', 'refresh']);
  });

  it('the one public sessions route exposes nothing but join info', () => {
    const text = readFileSync(
      join(SRC, 'sessions/sessions.controller.ts'),
      'utf8',
    );
    const publicBlock = text.slice(
      text.indexOf("@Controller('public/sessions')"),
    );
    expect([
      ...publicBlock.matchAll(/@(Get|Post|Patch|Put|Delete)\(/g),
    ]).toHaveLength(1);
    expect(publicBlock).toContain("@Get(':id/join')");
  });
});
