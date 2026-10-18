import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { CreateKnowledgeCollectionDto, UpdateKnowledgeCollectionDto } from './dto/knowledge-collection.dto';
import { KnowledgeCollectionService } from './knowledge-collection.service';

type AuthedRequest = Request & { user: { userId: string; orgId: string } };

/**
 * Reading collections only needs kb:read (same bar as reading sources
 * themselves); creating/editing/archiving a collection needs
 * kb:collections_manage — a separate, admin-level permission from
 * ordinary kb:write, since a collection is an org-wide governance
 * structure, not a single source's metadata.
 */
@Controller('knowledge/collections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeCollectionController {
  constructor(private readonly collections: KnowledgeCollectionService) {}

  @Get()
  @RequirePermissions('kb:read')
  list(@Req() req: AuthedRequest) {
    return this.collections.list(req.user.orgId);
  }

  @Post()
  @RequirePermissions('kb:collections_manage')
  create(@Req() req: AuthedRequest, @Body() dto: CreateKnowledgeCollectionDto) {
    return this.collections.create(req.user.orgId, req.user.userId, dto);
  }

  @Get(':id')
  @RequirePermissions('kb:read')
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.collections.getOne(req.user.orgId, id);
  }

  @Patch(':id')
  @RequirePermissions('kb:collections_manage')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateKnowledgeCollectionDto) {
    return this.collections.update(req.user.orgId, req.user.userId, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions('kb:collections_manage')
  archive(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.collections.archive(req.user.orgId, req.user.userId, id);
  }
}
