import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Organization as OrganizationDto } from '@pulsefeedback/shared';
import {
  Organization,
  OrganizationDocument,
} from '../schemas/organization.schema';
import { UpdateOrgDto } from './dto/update-org.dto';

const ORG_PATCH_KEYS = [
  'name',
  'address',
  'country',
  'description',
  'website',
  'domain',
  'phone',
  'timezone',
  'foundedYear',
  'logoUrl',
  'accentColor',
  'accentSoft',
  'tagline',
  'aiSystemPrompt',
  'blockedTopics',
  'piiRedactionEnabled',
  'retentionDays',
  'archiveAfterDays',
  'softDeleteEnabled',
] as const;

@Injectable()
export class OrgService {
  constructor(
    @InjectModel(Organization.name)
    private readonly orgs: Model<OrganizationDocument>,
  ) {}

  async get(orgId: string): Promise<OrganizationDto> {
    const doc = await this.orgs.findById(orgId).lean();
    if (!doc) throw new NotFoundException('Organization not found');
    return this.toDto(doc);
  }

  async update(orgId: string, dto: UpdateOrgDto): Promise<OrganizationDto> {
    const $set: Record<string, unknown> = {};
    for (const key of ORG_PATCH_KEYS) {
      if (dto[key] !== undefined) {
        $set[key] = dto[key];
      }
    }

    const doc = await this.orgs
      .findByIdAndUpdate(new Types.ObjectId(orgId), { $set }, { new: true })
      .lean();
    if (!doc) throw new NotFoundException('Organization not found');
    return this.toDto(doc);
  }

  private toDto(doc: {
    _id: Types.ObjectId;
    name: string;
    slug: string;
    address?: string | null;
    country?: string | null;
    description?: string | null;
    website?: string | null;
    domain?: string | null;
    phone?: string | null;
    timezone?: string | null;
    foundedYear?: string | null;
    logoUrl?: string | null;
    accentColor?: string | null;
    accentSoft?: string | null;
    tagline?: string | null;
    aiSystemPrompt?: string | null;
    blockedTopics?: string[];
    piiRedactionEnabled?: boolean;
    retentionDays?: number;
    archiveAfterDays?: number;
    softDeleteEnabled?: boolean;
    createdAt?: Date;
  }): OrganizationDto {
    return {
      id: String(doc._id),
      name: doc.name,
      slug: doc.slug,
      address: doc.address ?? null,
      country: doc.country ?? null,
      description: doc.description ?? null,
      website: doc.website ?? null,
      domain: doc.domain ?? null,
      phone: doc.phone ?? null,
      timezone: doc.timezone ?? null,
      foundedYear: doc.foundedYear ?? null,
      logoUrl: doc.logoUrl ?? null,
      accentColor: doc.accentColor ?? null,
      accentSoft: doc.accentSoft ?? null,
      tagline: doc.tagline ?? null,
      aiSystemPrompt: doc.aiSystemPrompt ?? null,
      blockedTopics: doc.blockedTopics ?? [],
      piiRedactionEnabled: doc.piiRedactionEnabled ?? true,
      retentionDays: doc.retentionDays ?? 365,
      archiveAfterDays: doc.archiveAfterDays ?? 90,
      softDeleteEnabled: doc.softDeleteEnabled ?? true,
      createdAt: (doc.createdAt ?? new Date()).toISOString(),
    };
  }
}
