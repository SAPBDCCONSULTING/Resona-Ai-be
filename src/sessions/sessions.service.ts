import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  sessionFilterToQuery,
  sessionJoinPath,
  type CreateEntryMode,
  type FeedbackSession,
  type LaunchSessionResult,
  type SessionBoardFilter,
  type SessionJoinInfo,
  type SessionListResponse,
  type SessionSortBy,
  type SessionStatus,
  type SessionType,
  type WizardStep,
} from '@pulsefeedback/shared';
import { Session, SessionDocument } from '../schemas/session.schema';
import { ContactsService } from '../contacts/contacts.service';
import { CreateDraftDto, UpdateDraftDto } from './dto/session-draft.dto';

export type ListSessionsInput = {
  orgId: string;
  type?: SessionType;
  filter?: SessionBoardFilter;
  sortBy?: SessionSortBy;
  search?: string;
  limit?: number;
};

export type Actor = {
  userId: string;
  orgId: string;
  name: string;
};

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    private readonly config: ConfigService,
    private readonly contactsService: ContactsService,
  ) {}

  async list(input: ListSessionsInput): Promise<SessionListResponse> {
    const limit = Math.min(input.limit ?? 50, 100);
    const mongoFilter: FilterQuery<SessionDocument> = {
      orgId: new Types.ObjectId(input.orgId),
    };

    if (input.type) mongoFilter.type = input.type;

    if (input.filter) {
      const mapped = sessionFilterToQuery(input.filter);
      if (mapped.status) mongoFilter.status = mapped.status;
      if (mapped.favorite !== undefined) mongoFilter.favorite = mapped.favorite;
    }

    if (input.search?.trim()) {
      mongoFilter.title = { $regex: input.search.trim(), $options: 'i' };
    }

    const sort = this.resolveSort(input.sortBy);
    const docs = await this.sessions.find(mongoFilter).sort(sort).limit(limit).lean();
    const items = docs.map((d) => this.toDto(d));

    return {
      items,
      columns: {
        one_on_one: items.filter((s) => s.type === 'one_on_one'),
        survey: items.filter((s) => s.type === 'survey'),
      },
    };
  }

  async getOne(orgId: string, id: string): Promise<FeedbackSession> {
    const doc = await this.sessions
      .findOne({ _id: id, orgId: new Types.ObjectId(orgId) })
      .lean();
    if (!doc) throw new NotFoundException('Session not found');
    return this.toDto(doc);
  }

  async createDraft(actor: Actor, dto: CreateDraftDto): Promise<FeedbackSession> {
    const entryMode: CreateEntryMode = dto.entryMode ?? 'blank';
    const wizardStep: WizardStep =
      dto.wizardStep ?? (entryMode === 'quick_create' ? 'schedule' : 'choose_type');

    const doc = await this.sessions.create({
      orgId: new Types.ObjectId(actor.orgId),
      title: dto.title?.trim() || 'Untitled session',
      type: dto.type ?? 'one_on_one',
      status: 'draft',
      startAt: null,
      endAt: null,
      createdBy: new Types.ObjectId(actor.userId),
      createdByName: actor.name,
      campaignId: null,
      progress: { invited: 0, completed: 0, percent: 0, health: 'no_schedule' },
      favorite: false,
      topics: [],
      goalPrompt: dto.goalPrompt ?? null,
      wizardStep,
      entryMode,
      tone: null,
      reportTemplateId: null,
      participantIds: [],
      assignedUserIds: [],
      participantTitle: null,
      participantDescription: null,
      welcomeMessage: null,
      anonymous: false,
      invitation: { subject: '', header: '', body: '' },
      engagementMetrics: [],
    });

    return this.toDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  async updateDraft(orgId: string, id: string, dto: UpdateDraftDto): Promise<FeedbackSession> {
    const updates: Record<string, unknown> = {};
    if (dto.title !== undefined) updates.title = dto.title.trim() || 'Untitled session';
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.goalPrompt !== undefined) updates.goalPrompt = dto.goalPrompt;
    if (dto.tone !== undefined) updates.tone = dto.tone;
    if (dto.topics !== undefined) updates.topics = dto.topics;
    if (dto.wizardStep !== undefined) updates.wizardStep = dto.wizardStep;
    if (dto.participantIds !== undefined) {
      updates.participantIds = dto.participantIds;
      updates['progress.invited'] = dto.participantIds.length;
    }
    if (dto.reportTemplateId !== undefined) updates.reportTemplateId = dto.reportTemplateId;
    if (dto.startAt !== undefined) updates.startAt = dto.startAt ? new Date(dto.startAt) : null;
    if (dto.endAt !== undefined) updates.endAt = dto.endAt ? new Date(dto.endAt) : null;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.participantTitle !== undefined) updates.participantTitle = dto.participantTitle;
    if (dto.participantDescription !== undefined) {
      updates.participantDescription = dto.participantDescription;
    }
    if (dto.welcomeMessage !== undefined) updates.welcomeMessage = dto.welcomeMessage;
    if (dto.anonymous !== undefined) updates.anonymous = dto.anonymous;
    if (dto.engagementMetrics !== undefined) updates.engagementMetrics = dto.engagementMetrics;
    if (dto.invitation !== undefined) {
      if (dto.invitation.subject !== undefined) updates['invitation.subject'] = dto.invitation.subject;
      if (dto.invitation.header !== undefined) updates['invitation.header'] = dto.invitation.header;
      if (dto.invitation.body !== undefined) updates['invitation.body'] = dto.invitation.body;
    }

    const doc = await this.sessions
      .findOneAndUpdate(
        { _id: id, orgId: new Types.ObjectId(orgId) },
        { $set: updates },
        { new: true },
      )
      .lean();

    if (!doc) throw new NotFoundException('Session not found');
    return this.toDto(doc);
  }

  async launch(
    orgId: string,
    id: string,
    body: { startAt?: string | null; endAt?: string | null },
  ): Promise<LaunchSessionResult> {
    const existing = await this.getOne(orgId, id);
    if (!existing.title?.trim()) {
      throw new BadRequestException('Title is required before launch');
    }

    const startAt = body.startAt ?? existing.startAt ?? new Date().toISOString();
    const endAt =
      body.endAt ??
      existing.endAt ??
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const startMs = new Date(startAt).getTime();
    const endMs = new Date(endAt).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new BadRequestException('Invalid start or end date');
    }
    if (endMs <= startMs) {
      throw new BadRequestException('End must be after start');
    }

    // Future start → scheduled; now/past → ongoing (BullMQ start jobs come later).
    const status = startMs > Date.now() ? 'scheduled' : 'ongoing';

    const session = await this.updateDraft(orgId, id, {
      startAt,
      endAt,
      status,
      wizardStep: 'schedule',
    });

    // Resolve selected Contacts to their linked User accounts for employee-assignment
    // matching. participantIds stays Contact ids (S4 draft/resume depends on that);
    // assignedUserIds is the separate, resolved field responses/assignments key on.
    // Contacts with no linked User account (userId === null) are skipped for now —
    // account creation/invitation is a future task, not handled here.
    const contacts = await this.contactsService.findByIds(orgId, existing.participantIds);
    const userIdByContactId = new Map(contacts.map((c) => [c.id, c.userId]));
    const assignedUserIds = existing.participantIds
      .map((contactId) => userIdByContactId.get(contactId) ?? null)
      .filter((userId): userId is string => userId !== null);

    await this.sessions.updateOne(
      { _id: id, orgId: new Types.ObjectId(orgId) },
      { $set: { assignedUserIds, 'progress.invited': assignedUserIds.length } },
    );
    session.assignedUserIds = assignedUserIds;
    session.progress = { ...session.progress, invited: assignedUserIds.length };

    const joinPath = sessionJoinPath(session);
    const employeeBase = this.config.get<string>(
      'EMPLOYEE_APP_URL',
      'http://localhost:3001',
    );
    return {
      session,
      joinPath,
      joinUrl: `${employeeBase.replace(/\/$/, '')}${joinPath}`,
    };
  }

  /**
   * If a scheduled session's startAt has passed, flip to ongoing.
   * Stand-in for BullMQ *-start until schedulers land.
   */
  async softActivateIfDue(id: string): Promise<FeedbackSession | null> {
    const doc = await this.sessions.findById(id);
    if (!doc) return null;
    if (doc.status !== 'scheduled') {
      return this.toDto(doc.toObject() as unknown as Record<string, unknown>);
    }
    const start = doc.startAt instanceof Date ? doc.startAt : null;
    if (start && start.getTime() <= Date.now()) {
      doc.status = 'ongoing';
      await doc.save();
    }
    return this.toDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  acceptingResponses(session: Pick<FeedbackSession, 'status' | 'startAt' | 'endAt'>): boolean {
    if (session.status !== 'ongoing') return false;
    const now = Date.now();
    if (session.endAt && new Date(session.endAt).getTime() < now) return false;
    if (session.startAt && new Date(session.startAt).getTime() > now) return false;
    return true;
  }

  async getJoinInfo(id: string): Promise<SessionJoinInfo> {
    const activated = await this.softActivateIfDue(id);
    if (!activated) throw new NotFoundException('Session not found');
    if (!['ongoing', 'scheduled'].includes(activated.status)) {
      throw new BadRequestException('Session is not open for joining');
    }
    if (activated.endAt && new Date(activated.endAt).getTime() < Date.now()) {
      throw new BadRequestException('Session has ended');
    }
    return {
      id: activated.id,
      title: activated.title,
      type: activated.type,
      status: activated.status,
      topics: activated.topics,
      startAt: activated.startAt,
      endAt: activated.endAt,
      joinPath: sessionJoinPath(activated),
      acceptingResponses: this.acceptingResponses(activated),
    };
  }

  private resolveSort(sortBy?: SessionSortBy): Record<string, 1 | -1> {
    switch (sortBy) {
      case 'startAt':
        return { startAt: 1 };
      case 'title':
        return { title: 1 };
      case 'updatedAt':
        return { updatedAt: -1 };
      case 'endAt':
      case 'custom':
      default:
        return { endAt: 1 };
    }
  }

  private toDto(d: Record<string, unknown>): FeedbackSession {
    const progress = (d.progress as FeedbackSession['progress']) ?? {
      invited: 0,
      completed: 0,
      percent: 0,
      health: 'no_schedule' as const,
    };
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    const updatedAt = d.updatedAt instanceof Date ? d.updatedAt.toISOString() : createdAt;

    return {
      id: String(d._id),
      orgId: String(d.orgId),
      title: String(d.title),
      type: d.type as FeedbackSession['type'],
      status: d.status as FeedbackSession['status'],
      startAt: d.startAt instanceof Date ? d.startAt.toISOString() : null,
      endAt: d.endAt instanceof Date ? d.endAt.toISOString() : null,
      createdBy: String(d.createdBy),
      createdByName: String(d.createdByName ?? ''),
      campaignId: d.campaignId ? String(d.campaignId) : null,
      progress,
      favorite: Boolean(d.favorite),
      participantCount: progress.invited,
      topics: Array.isArray(d.topics) ? (d.topics as FeedbackSession['topics']) : [],
      goalPrompt: (d.goalPrompt as string | null) ?? null,
      wizardStep: (d.wizardStep as FeedbackSession['wizardStep']) ?? 'choose_type',
      entryMode: (d.entryMode as FeedbackSession['entryMode']) ?? 'blank',
      tone: (d.tone as string | null) ?? null,
      reportTemplateId: (d.reportTemplateId as string | null) ?? null,
      participantIds: Array.isArray(d.participantIds)
        ? (d.participantIds as string[])
        : [],
      assignedUserIds: Array.isArray(d.assignedUserIds)
        ? (d.assignedUserIds as string[])
        : [],
      participantTitle: (d.participantTitle as string | null) ?? null,
      participantDescription: (d.participantDescription as string | null) ?? null,
      welcomeMessage: (d.welcomeMessage as string | null) ?? null,
      anonymous: Boolean(d.anonymous),
      invitation: {
        subject: String((d.invitation as { subject?: string } | undefined)?.subject ?? ''),
        header: String((d.invitation as { header?: string } | undefined)?.header ?? ''),
        body: String((d.invitation as { body?: string } | undefined)?.body ?? ''),
      },
      engagementMetrics: Array.isArray(d.engagementMetrics)
        ? (d.engagementMetrics as string[])
        : [],
      createdAt,
      updatedAt,
    };
  }
}
