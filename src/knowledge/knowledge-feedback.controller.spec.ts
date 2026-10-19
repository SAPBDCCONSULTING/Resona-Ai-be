import type { Request } from 'express';
import type { PermissionKey } from '@pulsefeedback/shared';
import { KnowledgeFeedbackController } from './knowledge-feedback.controller';
import { KnowledgeFeedbackService } from './knowledge-feedback.service';

type AuthedRequest = Request & {
  user: { userId: string; orgId: string; permissions?: PermissionKey[] };
};

function makeReq(userId: string, orgId: string, permissions: PermissionKey[] = []): AuthedRequest {
  return { user: { userId, orgId, permissions } } as unknown as AuthedRequest;
}

function makeService(): KnowledgeFeedbackService {
  return {
    submit: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue([]),
    resolve: jest.fn().mockResolvedValue({}),
  } as unknown as KnowledgeFeedbackService;
}

describe('KnowledgeFeedbackController', () => {
  it('derives orgId/userId from the authenticated request, never from the request body', async () => {
    const service = makeService();
    const controller = new KnowledgeFeedbackController(service);
    const req = makeReq('real-user-id', 'real-org-id');

    await controller.submit(req, { rating: 'helpful' });
    await controller.list(req);
    await controller.resolve(req, 'fb-id', { status: 'resolved' });

    expect(service.submit).toHaveBeenCalledWith('real-org-id', 'real-user-id', { rating: 'helpful' });
    expect(service.list).toHaveBeenCalledWith('real-org-id', 'real-user-id', false, { status: undefined });
    expect(service.resolve).toHaveBeenCalledWith('real-org-id', 'real-user-id', false, 'fb-id', {
      status: 'resolved',
    });
  });

  it('passes canManage=true only when the caller actually holds kb:feedback_manage', async () => {
    const service = makeService();
    const controller = new KnowledgeFeedbackController(service);
    const req = makeReq('real-user-id', 'real-org-id', ['kb:feedback_manage']);

    await controller.list(req, 'open');
    await controller.resolve(req, 'fb-id', { status: 'dismissed' });

    expect(service.list).toHaveBeenCalledWith('real-org-id', 'real-user-id', true, { status: 'open' });
    expect(service.resolve).toHaveBeenCalledWith('real-org-id', 'real-user-id', true, 'fb-id', {
      status: 'dismissed',
    });
  });
});
