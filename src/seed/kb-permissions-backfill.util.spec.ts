import { ADMIN_PERMS, ANALYST_PERMS, EMPLOYEE_PERMS } from './role-permission-sets';
import {
  COVERED_ROLE_NAMES,
  computeKbPermissionGrants,
  targetKbPermissionsForRole,
} from './kb-permissions-backfill.util';

describe('targetKbPermissionsForRole', () => {
  it('targets exactly the kb:* subset of ADMIN_PERMS for "Admin"', () => {
    const expected = ADMIN_PERMS.filter((p) => p.startsWith('kb:'));
    expect(targetKbPermissionsForRole('Admin')).toEqual(expected);
    expect(targetKbPermissionsForRole('Admin')).toEqual(
      expect.arrayContaining(['kb:read', 'kb:write', 'kb:publish', 'kb:archive']),
    );
  });

  it('targets exactly the kb:* subset of ANALYST_PERMS for "Analyst"', () => {
    const expected = ANALYST_PERMS.filter((p) => p.startsWith('kb:'));
    expect(targetKbPermissionsForRole('Analyst')).toEqual(expected);
    expect(targetKbPermissionsForRole('Analyst')).toEqual(['kb:read']);
  });

  it('never targets anything for "Employee" — EMPLOYEE_PERMS grants no kb:* permission', () => {
    expect(EMPLOYEE_PERMS.some((p) => p.startsWith('kb:'))).toBe(false);
    expect(targetKbPermissionsForRole('Employee')).toEqual([]);
  });

  it('never targets anything for a custom/unrecognized role name', () => {
    expect(targetKbPermissionsForRole('Regional Manager')).toEqual([]);
    expect(targetKbPermissionsForRole('')).toEqual([]);
  });

  it('only covers Admin and Analyst', () => {
    expect(COVERED_ROLE_NAMES.sort()).toEqual(['Admin', 'Analyst']);
  });
});

describe('computeKbPermissionGrants', () => {
  it('grants all kb:* permissions to a pre-existing Admin role that has none of them', () => {
    const existing = ADMIN_PERMS.filter((p) => !p.startsWith('kb:'));
    const grants = computeKbPermissionGrants('Admin', existing);
    expect(grants.sort()).toEqual([
      'kb:archive',
      'kb:collections_manage',
      'kb:delete',
      'kb:feedback_manage',
      'kb:publish',
      'kb:read',
      'kb:web_ingest',
      'kb:web_manage',
      'kb:write',
    ]);
  });

  it('is additive only — never suggests removing a permission the role already has', () => {
    const existing = [...ADMIN_PERMS, 'a-totally-custom-permission' as never];
    const grants = computeKbPermissionGrants('Admin', existing);
    expect(grants).toEqual([]); // already has everything; nothing missing
  });

  it('grants only the missing subset when a role already has some kb:* permissions', () => {
    const existing = ['org:read' as never, 'kb:read' as never];
    const grants = computeKbPermissionGrants('Admin', existing);
    expect(grants.sort()).toEqual([
      'kb:archive',
      'kb:collections_manage',
      'kb:delete',
      'kb:feedback_manage',
      'kb:publish',
      'kb:web_ingest',
      'kb:web_manage',
      'kb:write',
    ]);
  });

  it('is a no-op (idempotent) once a role already has the full target set', () => {
    const existing = ANALYST_PERMS;
    expect(computeKbPermissionGrants('Analyst', existing)).toEqual([]);
  });

  it('never grants kb:publish or kb:archive to Analyst — least privilege is preserved', () => {
    const grants = computeKbPermissionGrants('Analyst', []);
    expect(grants).not.toContain('kb:publish');
    expect(grants).not.toContain('kb:archive');
  });

  it('never grants anything to a role name outside the covered set, regardless of its current permissions', () => {
    expect(computeKbPermissionGrants('Employee', [])).toEqual([]);
    expect(computeKbPermissionGrants('Some Custom Role', ['org:read' as never])).toEqual([]);
  });
});
