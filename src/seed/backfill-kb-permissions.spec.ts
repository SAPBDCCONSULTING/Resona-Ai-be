import { Types } from 'mongoose';
import { runKbPermissionsBackfill, type RoleModelLike } from './backfill-kb-permissions';
import { ADMIN_PERMS, ANALYST_PERMS } from './role-permission-sets';

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function makeRoleModel(
  rolesByName: Record<string, { _id: unknown; orgId: unknown; permissions: string[] }[]>,
): RoleModelLike & { find: jest.Mock; updateOne: jest.Mock } {
  return {
    find: jest.fn((filter: { name: string }) => leanChain(rolesByName[filter.name] ?? [])),
    updateOne: jest.fn().mockResolvedValue({}),
  };
}

const orgId = new Types.ObjectId();

describe('runKbPermissionsBackfill — dry-run', () => {
  it('reports every missing kb:* permission per role without writing anything', async () => {
    const adminId = new Types.ObjectId();
    const roleModel = makeRoleModel({
      Admin: [{ _id: adminId, orgId, permissions: ADMIN_PERMS.filter((p) => !p.startsWith('kb:')) }],
      Analyst: [],
    });

    const result = await runKbPermissionsBackfill(roleModel, { dryRun: true });

    expect(roleModel.updateOne).not.toHaveBeenCalled();
    expect(result.checked).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.logLines[0]).toContain('[dry-run] would grant');
    expect(result.logLines[0]).toContain('kb:read');
    expect(result.logLines[0]).toContain(`role "Admin"`);
    expect(result.logLines[0]).toContain(String(adminId));
  });

  it('never queries for a role name outside Admin/Analyst (e.g. Employee is never touched)', async () => {
    const roleModel = makeRoleModel({ Admin: [], Analyst: [] });

    await runKbPermissionsBackfill(roleModel, { dryRun: true });

    const queriedNames = roleModel.find.mock.calls.map((c) => c[0].name);
    expect(queriedNames.sort()).toEqual(['Admin', 'Analyst']);
    expect(queriedNames).not.toContain('Employee');
  });

  it('explicitly states no changes are needed when every covered role already has its target permissions', async () => {
    const roleModel = makeRoleModel({
      Admin: [{ _id: new Types.ObjectId(), orgId, permissions: ADMIN_PERMS }],
      Analyst: [{ _id: new Types.ObjectId(), orgId, permissions: ANALYST_PERMS }],
    });

    const result = await runKbPermissionsBackfill(roleModel, { dryRun: true });

    expect(result.changed).toBe(0);
    expect(result.logLines.some((l) => l.includes('No changes needed'))).toBe(true);
    expect(roleModel.updateOne).not.toHaveBeenCalled();
  });

  it('explicitly states when no covered role documents exist at all, distinct from "no changes needed"', async () => {
    const roleModel = makeRoleModel({ Admin: [], Analyst: [] });

    const result = await runKbPermissionsBackfill(roleModel, { dryRun: true });

    expect(result.checked).toBe(0);
    expect(result.logLines.some((l) => l.includes('No role documents named'))).toBe(true);
    expect(result.logLines.some((l) => l.includes('No changes needed'))).toBe(false);
  });
});

describe('runKbPermissionsBackfill — apply (dryRun: false)', () => {
  it('writes the missing permissions via $addToSet, never removing anything a role already has', async () => {
    const adminId = new Types.ObjectId();
    const roleModel = makeRoleModel({
      Admin: [
        {
          _id: adminId,
          orgId,
          permissions: [...ADMIN_PERMS.filter((p) => !p.startsWith('kb:')), 'custom:extra' as never],
        },
      ],
      Analyst: [],
    });

    const result = await runKbPermissionsBackfill(roleModel, { dryRun: false });

    expect(roleModel.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = roleModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: adminId });
    expect(update.$addToSet.permissions.$each).toEqual(
      expect.arrayContaining(['kb:read', 'kb:write', 'kb:delete']),
    );
    expect(result.logLines[0]).toContain('granting');
    expect(result.logLines[0]).not.toContain('[dry-run]');
  });

  it('is idempotent: running it again after the grant reports zero further changes and zero further writes', async () => {
    const adminId = new Types.ObjectId();
    const rolesByName = {
      Admin: [{ _id: adminId, orgId, permissions: ADMIN_PERMS.filter((p) => !p.startsWith('kb:')) }],
      Analyst: [] as { _id: unknown; orgId: unknown; permissions: string[] }[],
    };
    const roleModel = makeRoleModel(rolesByName);

    const first = await runKbPermissionsBackfill(roleModel, { dryRun: false });
    expect(first.changed).toBe(1);
    expect(roleModel.updateOne).toHaveBeenCalledTimes(1);

    // Simulate the write having actually landed, then run again.
    rolesByName.Admin[0].permissions = [...rolesByName.Admin[0].permissions, ...ADMIN_PERMS.filter((p) => p.startsWith('kb:'))];
    roleModel.updateOne.mockClear();

    const second = await runKbPermissionsBackfill(roleModel, { dryRun: false });

    expect(second.changed).toBe(0);
    expect(roleModel.updateOne).not.toHaveBeenCalled();
    expect(second.logLines.some((l) => l.includes('No changes needed'))).toBe(true);
  });
});
