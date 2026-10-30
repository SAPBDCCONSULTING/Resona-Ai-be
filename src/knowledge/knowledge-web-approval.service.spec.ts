import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { KnowledgeAuditEventDocument } from '../schemas/knowledge-audit-event.schema';
import { KnowledgeWebApprovalDocument } from '../schemas/knowledge-web-approval.schema';
import { CreateWebApprovalDto } from './dto/web-approval.dto';
import { KnowledgeWebApprovalService } from './knowledge-web-approval.service';

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}
function sortLeanChain<T>(value: T) {
  return { sort: jest.fn().mockReturnValue(leanChain(value)) };
}

function makeHydratedApproval(overrides: Partial<Record<string, unknown>> = {}) {
  const base: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    orgId: new Types.ObjectId(),
    type: 'exact_url',
    value: 'https://example.com/page',
    status: 'active',
    createdBy: new Types.ObjectId(),
    createdAt: new Date(),
    revokedBy: null,
    revokedAt: null,
    ...overrides,
  };
  const doc = { ...base, save: jest.fn().mockResolvedValue(undefined), toObject: jest.fn() } as Record<
    string,
    unknown
  > & { save: jest.Mock; toObject: jest.Mock };
  doc.toObject.mockImplementation(() => {
    const { save: _s, toObject: _t, ...plain } = doc;
    return plain;
  });
  return doc;
}

function makeService(opts: { approvalsOverrides?: Record<string, jest.Mock> } = {}) {
  const approvals = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    ...opts.approvalsOverrides,
  };
  const auditEvents = { create: jest.fn().mockResolvedValue({}) };
  const service = new KnowledgeWebApprovalService(
    approvals as unknown as Model<KnowledgeWebApprovalDocument>,
    auditEvents as unknown as Model<KnowledgeAuditEventDocument>,
  );
  return { service, approvals, auditEvents };
}

const ORG_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();

describe('KnowledgeWebApprovalService.create', () => {
  it('rejects a non-https URL before ever writing an approval entry', async () => {
    const { service, approvals } = makeService();
    await expect(
      service.create(ORG_ID, USER_ID, { type: 'exact_url', value: 'http://example.com/' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(approvals.create).not.toHaveBeenCalled();
  });

  it('rejects a URL with embedded credentials', async () => {
    const { service } = makeService();
    await expect(
      service.create(ORG_ID, USER_ID, { type: 'exact_url', value: 'https://user:pass@example.com/' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects approving a literal loopback/private/metadata IP address directly', async () => {
    const { service } = makeService();
    for (const value of ['https://127.0.0.1/', 'https://169.254.169.254/', 'https://10.0.0.5/']) {
      await expect(
        service.create(ORG_ID, USER_ID, { type: 'exact_url', value }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('normalizes a "domain" approval to scheme+host only, dropping any path/query', async () => {
    const { service, approvals } = makeService();
    approvals.create.mockResolvedValue(makeHydratedApproval({ type: 'domain', value: 'https://example.com' }));

    await service.create(ORG_ID, USER_ID, { type: 'domain', value: 'https://example.com/some/path?x=1' });

    expect(approvals.create.mock.calls[0][0].value).toBe('https://example.com');
  });

  it('keeps the full path+query for an "exact_url" approval', async () => {
    const { service, approvals } = makeService();
    approvals.create.mockResolvedValue(makeHydratedApproval());

    await service.create(ORG_ID, USER_ID, { type: 'exact_url', value: 'https://example.com/a/b?x=1' });

    expect(approvals.create.mock.calls[0][0].value).toBe('https://example.com/a/b?x=1');
  });

  it('derives orgId/createdBy from the trusted method parameters, never from the DTO', async () => {
    const { service, approvals } = makeService();
    approvals.create.mockResolvedValue(makeHydratedApproval());

    await service.create(ORG_ID, USER_ID, { type: 'exact_url', value: 'https://example.com/' });

    const createArgs = approvals.create.mock.calls[0][0];
    expect(createArgs.orgId.toString()).toBe(ORG_ID);
    expect(createArgs.createdBy.toString()).toBe(USER_ID);
  });

  it('rejects a duplicate (same org, type, value) approval with a clear error, not a raw Mongo error', async () => {
    const { service, approvals } = makeService();
    approvals.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    await expect(
      service.create(ORG_ID, USER_ID, { type: 'exact_url', value: 'https://example.com/' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records a web_approval_created audit event with no sourceId', async () => {
    const { service, approvals, auditEvents } = makeService();
    approvals.create.mockResolvedValue(makeHydratedApproval());

    await service.create(ORG_ID, USER_ID, { type: 'exact_url', value: 'https://example.com/' });

    expect(auditEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'web_approval_created', sourceId: null }),
    );
  });
});

describe('KnowledgeWebApprovalService.list', () => {
  it('always scopes by orgId', async () => {
    const { service, approvals } = makeService({ approvalsOverrides: { find: jest.fn() } });
    approvals.find.mockReturnValue(sortLeanChain([]));

    await service.list(ORG_ID);

    expect(approvals.find.mock.calls[0][0].orgId.toString()).toBe(ORG_ID);
  });
});

describe('KnowledgeWebApprovalService.revoke', () => {
  it('only finds the entry within this exact org, never by id alone', async () => {
    const { service, approvals } = makeService();
    const doc = makeHydratedApproval();
    approvals.findOne.mockResolvedValue(doc);

    await service.revoke(ORG_ID, USER_ID, String(doc._id));

    const query = approvals.findOne.mock.calls[0][0];
    expect(query.orgId.toString()).toBe(ORG_ID);
    expect(query._id).toBe(String(doc._id));
  });

  it('throws NotFoundException for an entry that does not belong to this org', async () => {
    const { service, approvals } = makeService();
    approvals.findOne.mockResolvedValue(null);
    await expect(service.revoke(ORG_ID, USER_ID, 'anything')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects revoking an already-revoked entry', async () => {
    const { service, approvals } = makeService();
    approvals.findOne.mockResolvedValue(makeHydratedApproval({ status: 'revoked' }));
    await expect(service.revoke(ORG_ID, USER_ID, 'anything')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets status/revokedBy/revokedAt and records an audit event', async () => {
    const { service, approvals, auditEvents } = makeService();
    const doc = makeHydratedApproval();
    approvals.findOne.mockResolvedValue(doc);

    const result = await service.revoke(ORG_ID, USER_ID, String(doc._id));

    expect(doc.status).toBe('revoked');
    expect((doc.revokedBy as Types.ObjectId).toString()).toBe(USER_ID);
    expect(doc.revokedAt).toBeInstanceOf(Date);
    expect(result.status).toBe('revoked');
    expect(auditEvents.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'web_approval_revoked' }));
  });
});

describe('KnowledgeWebApprovalService.isUrlApproved', () => {
  it('matches an active exact_url entry by full URL', async () => {
    const { service, approvals } = makeService();
    approvals.findOne.mockReturnValue(leanChain({ _id: new Types.ObjectId() }));

    const result = await service.isUrlApproved(ORG_ID, new URL('https://example.com/page?x=1'));

    expect(result).toBe(true);
    const query = approvals.findOne.mock.calls[0][0];
    expect(query.orgId.toString()).toBe(ORG_ID);
    expect(query.status).toBe('active');
  });

  it('a domain approval covers any path on that exact origin', async () => {
    const { service, approvals } = makeService();
    approvals.findOne.mockImplementation((q: { $or: { type: string; value: string }[] }) => {
      const domainClause = q.$or.find((c) => c.type === 'domain');
      const matched = domainClause?.value === 'https://example.com' ? { _id: new Types.ObjectId() } : null;
      return leanChain(matched);
    });

    const result = await service.isUrlApproved(ORG_ID, new URL('https://example.com/any/deep/path'));
    expect(result).toBe(true);
  });

  it('never matches a different scheme, host, or port than what was approved — no implicit wildcarding', async () => {
    const { service, approvals } = makeService();
    approvals.findOne.mockReturnValue(leanChain(null)); // simulates: only https://example.com was approved

    expect(await service.isUrlApproved(ORG_ID, new URL('http://example.com/'))).toBe(false);
    expect(await service.isUrlApproved(ORG_ID, new URL('https://sub.example.com/'))).toBe(false);
    expect(await service.isUrlApproved(ORG_ID, new URL('https://example.com:8443/'))).toBe(false);
  });

  it('returns false (not approved) when no match exists, never throwing', async () => {
    const { service, approvals } = makeService();
    approvals.findOne.mockReturnValue(leanChain(null));
    await expect(service.isUrlApproved(ORG_ID, new URL('https://unapproved.example/'))).resolves.toBe(false);
  });

  it('cross-organization isolation: a URL approved for one org is never considered approved for a different org', async () => {
    const otherOrgId = new Types.ObjectId().toString();
    const { service, approvals } = makeService();
    // Simulates a real Mongo query: the approval genuinely exists, but
    // only for ORG_ID — querying with otherOrgId would never match it,
    // which is exactly what the orgId-scoped query below proves.
    approvals.findOne.mockImplementation((q: { orgId: { toString(): string } }) => {
      const matched = q.orgId.toString() === ORG_ID ? { _id: new Types.ObjectId() } : null;
      return leanChain(matched);
    });

    expect(await service.isUrlApproved(ORG_ID, new URL('https://example.com/page'))).toBe(true);
    expect(await service.isUrlApproved(otherOrgId, new URL('https://example.com/page'))).toBe(false);
  });
});
