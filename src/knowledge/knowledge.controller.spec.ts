import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

type AuthedRequest = Request & { user: { userId: string; orgId: string } };

function makeReq(userId: string, orgId: string): AuthedRequest {
  return { user: { userId, orgId } } as unknown as AuthedRequest;
}

function makeService(): KnowledgeService {
  return {
    upload: jest.fn().mockResolvedValue({ source: {}, duplicate: false }),
    list: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue({}),
    listChunks: jest.fn().mockResolvedValue([]),
    updateMetadata: jest.fn().mockResolvedValue({}),
    publish: jest.fn().mockResolvedValue({}),
    archive: jest.fn().mockResolvedValue({}),
    supersede: jest.fn().mockResolvedValue({}),
    getAuditLog: jest.fn().mockResolvedValue([]),
    reprocess: jest.fn().mockResolvedValue({}),
    reindexEmbeddings: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  } as unknown as KnowledgeService;
}

describe('KnowledgeController', () => {
  it('rejects an upload with no file attached', async () => {
    const service = makeService();
    const controller = new KnowledgeController(service);
    await expect(
      controller.upload(makeReq('u1', 'org1'), undefined, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('passes orgId and userId from the authenticated request, never from the request body', async () => {
    const service = makeService();
    const controller = new KnowledgeController(service);
    const file = { originalname: 'a.txt', mimetype: 'text/plain', size: 5, buffer: Buffer.from('hello') };

    await controller.upload(
      makeReq('real-user-id', 'real-org-id'),
      file as unknown as Express.Multer.File,
      { title: 'x' },
    );

    expect(service.upload).toHaveBeenCalledWith('real-org-id', 'real-user-id', file, { title: 'x' });
  });

  it('list/getOne/listChunks/publish/archive/supersede/audit/reprocess all scope by the authenticated orgId', async () => {
    const service = makeService();
    const controller = new KnowledgeController(service);
    const req = makeReq('u1', 'org-xyz');

    controller.list(req);
    controller.getOne(req, 'id1');
    controller.listChunks(req, 'id1');
    controller.publish(req, 'id1');
    controller.archive(req, 'id1');
    controller.supersede(req, 'id1', { supersededBySourceId: 'id2' });
    controller.getAuditLog(req, 'id1');
    controller.reprocess(req, 'id1');
    controller.reindexEmbeddings(req, 'id1');
    controller.delete(req, 'id1', { confirm: true });
    controller.updateMetadata(req, 'id1', {});

    expect(service.list).toHaveBeenCalledWith('org-xyz', expect.anything());
    expect(service.getOne).toHaveBeenCalledWith('org-xyz', 'id1');
    expect(service.listChunks).toHaveBeenCalledWith('org-xyz', 'id1');
    expect(service.publish).toHaveBeenCalledWith('org-xyz', 'u1', 'id1');
    expect(service.archive).toHaveBeenCalledWith('org-xyz', 'u1', 'id1');
    expect(service.supersede).toHaveBeenCalledWith('org-xyz', 'u1', 'id1', { supersededBySourceId: 'id2' });
    expect(service.getAuditLog).toHaveBeenCalledWith('org-xyz', 'id1');
    expect(service.reprocess).toHaveBeenCalledWith('org-xyz', 'u1', 'id1');
    expect(service.reindexEmbeddings).toHaveBeenCalledWith('org-xyz', 'u1', 'id1');
    expect(service.delete).toHaveBeenCalledWith('org-xyz', 'u1', 'id1', { confirm: true });
    expect(service.updateMetadata).toHaveBeenCalledWith('org-xyz', 'u1', 'id1', {});
  });

  it('parses the reviewOverdue query param as a real boolean, not the literal string', async () => {
    const service = makeService();
    const controller = new KnowledgeController(service);
    const req = makeReq('u1', 'org-xyz');

    controller.list(req, undefined, undefined, 'true');
    controller.list(req, undefined, undefined, undefined);

    expect(service.list).toHaveBeenNthCalledWith(1, 'org-xyz', expect.objectContaining({ reviewOverdue: true }));
    expect(service.list).toHaveBeenNthCalledWith(2, 'org-xyz', expect.objectContaining({ reviewOverdue: false }));
  });
});
