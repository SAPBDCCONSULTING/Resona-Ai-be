import { Types } from 'mongoose';
import {
  isOwnerRole,
  isSubset,
  symmetricDifference,
  withinAuthority,
  type Actor,
  type RoleLike,
} from './role-authority.service';

function actor(legacy: string[], grants: string[]): Actor {
  return {
    userId: String(new Types.ObjectId()),
    orgId: new Types.ObjectId(),
    roleId: new Types.ObjectId(),
    legacyPermissions: new Set(legacy),
    grants: new Set(grants),
  };
}

function role(partial: Partial<RoleLike> & { name: string }): RoleLike {
  return { _id: new Types.ObjectId(), ...partial };
}

describe('role authority rules (pure)', () => {
  it('isSubset', () => {
    expect(isSubset(['a'], new Set(['a', 'b']))).toBe(true);
    expect(isSubset([], new Set())).toBe(true);
    expect(isSubset(['c'], new Set(['a', 'b']))).toBe(false);
  });

  it('symmetricDifference returns keys added or removed, never unchanged ones', () => {
    expect(symmetricDifference(['a', 'b'], ['b', 'c']).sort()).toEqual([
      'a',
      'c',
    ]);
    expect(symmetricDifference(['a'], ['a'])).toEqual([]);
  });

  it('Owner is recognised case-insensitively and with surrounding whitespace', () => {
    expect(isOwnerRole({ name: 'Owner' })).toBe(true);
    expect(isOwnerRole({ name: '  oWnEr ' })).toBe(true);
    expect(isOwnerRole({ name: 'Owners' })).toBe(false);
  });

  describe('withinAuthority', () => {
    it('never allows an Owner role, whatever the actor holds', () => {
      const a = actor(['roles:write'], ['roles.update']);
      expect(withinAuthority(a, role({ name: 'Owner', permissions: [] }))).toBe(
        false,
      );
      expect(
        withinAuthority(
          a,
          role({ name: 'Owner', kind: 'custom', grants: ['roles.update'] }),
        ),
      ).toBe(false);
    });

    it('measures custom roles by granular grants only', () => {
      const a = actor([], ['sessions.read']);
      expect(
        withinAuthority(
          a,
          role({ name: 'X', kind: 'custom', grants: ['sessions.read'] }),
        ),
      ).toBe(true);
      expect(
        withinAuthority(
          a,
          role({
            name: 'Y',
            kind: 'custom',
            grants: ['sessions.read', 'sessions.launch'],
          }),
        ),
      ).toBe(false);
    });

    it('measures legacy roles by legacy permissions only (grants are not consulted)', () => {
      const a = actor(['sessions:read'], ['sessions.launch', 'sessions.read']);
      expect(
        withinAuthority(a, role({ name: 'L', permissions: ['sessions:read'] })),
      ).toBe(true);
      expect(
        withinAuthority(
          a,
          role({
            name: 'L2',
            permissions: ['sessions:read', 'sessions:launch'],
          }),
        ),
      ).toBe(false);
    });

    it('ignores the participant-only responses:write permission', () => {
      const a = actor(['sessions:read'], []);
      expect(
        withinAuthority(
          a,
          role({
            name: 'Employee',
            permissions: ['sessions:read', 'responses:write'],
          }),
        ),
      ).toBe(true);
    });

    it('a custom role with no grants is within anyone’s authority; a legacy role is not', () => {
      const a = actor([], []);
      expect(
        withinAuthority(a, role({ name: 'Z', kind: 'custom', grants: [] })),
      ).toBe(true);
      expect(
        withinAuthority(a, role({ name: 'Admin', permissions: ['org:write'] })),
      ).toBe(false);
    });
  });
});
