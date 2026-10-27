import type { Request } from 'express';
import { KnowledgeWebApprovalController } from './knowledge-web-approval.controller';
import { KnowledgeWebApprovalService } from './knowledge-web-approval.service';

type AuthedRequest = Request & { user: { userId: string; orgId: string } };

function makeReq(userId: string, orgId: string): AuthedRequest {
  return { user: { userId, orgId } } as unknown as AuthedRequest;
}

function makeService(): KnowledgeWebApprovalService {
  return {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    revoke: jest.fn().mockResolvedValue({}),
  } as unknown as KnowledgeWebApprovalService;
}

describe('KnowledgeWebApprovalController', () => {
  it('derives orgId/userId from the authenticated request, never from the request body', async () => {
    const service = makeService();
    const controller = new KnowledgeWebApprovalController(service);
    const req = makeReq('real-user-id', 'real-org-id');

    await controller.list(req);
    await controller.create(req, { type: 'exact_url', value: 'https://example.com/' });
    await controller.revoke(req, 'approval-id');

    expect(service.list).toHaveBeenCalledWith('real-org-id');
    expect(service.create).toHaveBeenCalledWith('real-org-id', 'real-user-id', {
      type: 'exact_url',
      value: 'https://example.com/',
    });
    expect(service.revoke).toHaveBeenCalledWith('real-org-id', 'real-user-id', 'approval-id');
  });
});
