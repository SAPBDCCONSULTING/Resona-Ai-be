import type { Request } from 'express';
import { KnowledgeCollectionController } from './knowledge-collection.controller';
import { KnowledgeCollectionService } from './knowledge-collection.service';

type AuthedRequest = Request & { user: { userId: string; orgId: string } };

function makeReq(userId: string, orgId: string): AuthedRequest {
  return { user: { userId, orgId } } as unknown as AuthedRequest;
}

function makeService(): KnowledgeCollectionService {
  return {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    getOne: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    archive: jest.fn().mockResolvedValue({}),
  } as unknown as KnowledgeCollectionService;
}

describe('KnowledgeCollectionController', () => {
  it('derives orgId/userId from the authenticated request, never from the request body', async () => {
    const service = makeService();
    const controller = new KnowledgeCollectionController(service);
    const req = makeReq('real-user-id', 'real-org-id');

    await controller.list(req);
    await controller.create(req, { key: 'hr_people' });
    await controller.getOne(req, 'col-id');
    await controller.update(req, 'col-id', { name: 'x' });
    await controller.archive(req, 'col-id');

    expect(service.list).toHaveBeenCalledWith('real-org-id');
    expect(service.create).toHaveBeenCalledWith('real-org-id', 'real-user-id', { key: 'hr_people' });
    expect(service.getOne).toHaveBeenCalledWith('real-org-id', 'col-id');
    expect(service.update).toHaveBeenCalledWith('real-org-id', 'real-user-id', 'col-id', { name: 'x' });
    expect(service.archive).toHaveBeenCalledWith('real-org-id', 'real-user-id', 'col-id');
  });
});
