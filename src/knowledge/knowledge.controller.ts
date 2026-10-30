import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { KbSurface } from '@pulsefeedback/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { KnowledgeService } from './knowledge.service';
import { DeleteKnowledgeSourceDto } from './dto/delete-source.dto';
import { IngestWebPageDto } from './dto/ingest-web-page.dto';
import { SupersedeKnowledgeSourceDto } from './dto/supersede-source.dto';
import { UpdateKnowledgeSourceDto } from './dto/update-source.dto';
import { UploadKnowledgeSourceDto } from './dto/upload-source.dto';

type AuthedRequest = Request & { user: { userId: string; orgId: string } };

/**
 * Hard ceiling at the multipart-parsing layer, well above the configurable
 * business limit (default 2MB, enforced precisely in KnowledgeService). This
 * stops an abusive giant upload from ever being fully buffered, independent
 * of whatever KB_MAX_UPLOAD_BYTES is currently configured to.
 */
const MULTER_HARD_CEILING_BYTES = 10 * 1024 * 1024;

@Controller('knowledge/sources')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post()
  @RequirePermissions('kb:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_CEILING_BYTES } }))
  async upload(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadKnowledgeSourceDto,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    return this.knowledge.upload(req.user.orgId, req.user.userId, file, dto);
  }

  /**
   * A separate permission from upload's kb:write — ingesting a web page
   * is a network-initiating action, not just a file write, and is kept
   * independently grantable.
   */
  @Post('web-ingest')
  @RequirePermissions('kb:web_ingest')
  ingestWebPage(@Req() req: AuthedRequest, @Body() dto: IngestWebPageDto) {
    return this.knowledge.ingestApprovedWebPage(req.user.orgId, req.user.userId, dto);
  }

  @Get()
  @RequirePermissions('kb:read')
  list(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('surface') surface?: KbSurface,
    @Query('reviewOverdue') reviewOverdue?: string,
  ) {
    return this.knowledge.list(req.user.orgId, { status, surface, reviewOverdue: reviewOverdue === 'true' });
  }

  @Get(':id')
  @RequirePermissions('kb:read')
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.getOne(req.user.orgId, id);
  }

  @Get(':id/chunks')
  @RequirePermissions('kb:read')
  listChunks(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.listChunks(req.user.orgId, id);
  }

  @Patch(':id')
  @RequirePermissions('kb:write')
  updateMetadata(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeSourceDto,
  ) {
    return this.knowledge.updateMetadata(req.user.orgId, req.user.userId, id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions('kb:publish')
  publish(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.publish(req.user.orgId, req.user.userId, id);
  }

  @Post(':id/archive')
  @RequirePermissions('kb:archive')
  archive(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.archive(req.user.orgId, req.user.userId, id);
  }

  @Post(':id/supersede')
  @RequirePermissions('kb:publish')
  supersede(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SupersedeKnowledgeSourceDto,
  ) {
    return this.knowledge.supersede(req.user.orgId, req.user.userId, id, dto);
  }

  @Get(':id/audit')
  @RequirePermissions('kb:read')
  getAuditLog(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.getAuditLog(req.user.orgId, id);
  }

  @Post(':id/reprocess')
  @RequirePermissions('kb:write')
  reprocess(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.reprocess(req.user.orgId, req.user.userId, id);
  }

  @Post(':id/reindex-embeddings')
  @RequirePermissions('kb:write')
  reindexEmbeddings(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.reindexEmbeddings(req.user.orgId, req.user.userId, id);
  }

  @Delete(':id')
  @RequirePermissions('kb:delete')
  delete(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DeleteKnowledgeSourceDto) {
    return this.knowledge.delete(req.user.orgId, req.user.userId, id, dto);
  }
}
