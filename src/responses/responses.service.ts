import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  sessionJoinPath,
  type EmployeeAssignment,
  type SessionResponse,
} from '@pulsefeedback/shared';
import { Response, ResponseDocument } from '../schemas/response.schema';
import { Session, SessionDocument } from '../schemas/session.schema';
import { SubmitResponseDto } from './dto/submit-response.dto';

@Injectable()
export class ResponsesService {
  constructor(
    @InjectModel(Response.name) private readonly responses: Model<ResponseDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
  ) {}

  async listAssignments(userId: string, orgId: string): Promise<EmployeeAssignment[]> {
    const sessions = await this.sessions
      .find({
        orgId: new Types.ObjectId(orgId),
        status: { $in: ['ongoing', 'scheduled'] },
        participantIds: userId,
      })
      .sort({ endAt: 1 })
      .lean();

    const submitted = await this.responses
      .find({
        userId: new Types.ObjectId(userId),
        sessionId: { $in: sessions.map((s) => s._id) },
      })
      .select('sessionId')
      .lean();
    const done = new Set(submitted.map((r) => String(r.sessionId)));

    return sessions.map((s) => {
      const id = String(s._id);
      const type = s.type as EmployeeAssignment['type'];
      return {
        id,
        title: s.title,
        type,
        status: s.status as EmployeeAssignment['status'],
        endAt: s.endAt instanceof Date ? s.endAt.toISOString() : null,
        topicsCount: Array.isArray(s.topics) ? s.topics.length : 0,
        completedByMe: done.has(id),
        joinPath: sessionJoinPath({ id, type }),
      };
    });
  }

  async getMine(sessionId: string, userId: string): Promise<SessionResponse | null> {
    const doc = await this.responses
      .findOne({
        sessionId: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(userId),
      })
      .lean();
    return doc ? this.toDto(doc) : null;
  }

  async submit(
    sessionId: string,
    actor: { userId: string; orgId: string },
    dto: SubmitResponseDto,
  ): Promise<SessionResponse> {
    const session = await this.sessions.findById(sessionId).lean();
    if (!session) throw new NotFoundException('Session not found');
    if (String(session.orgId) !== actor.orgId) {
      throw new ForbiddenException('Session is in another organization');
    }
    if (!['ongoing', 'scheduled'].includes(String(session.status))) {
      throw new BadRequestException('Session is not open for responses');
    }

    const participantIds = Array.isArray(session.participantIds)
      ? (session.participantIds as string[])
      : [];
    if (!participantIds.includes(actor.userId)) {
      throw new ForbiddenException('You are not assigned to this session');
    }

    const existing = await this.responses.findOne({
      sessionId: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(actor.userId),
    });
    if (existing) {
      throw new ConflictException('You already submitted a response for this session');
    }

    const created = await this.responses.create({
      orgId: new Types.ObjectId(actor.orgId),
      sessionId: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(actor.userId),
      answers: dto.answers.map((a) => ({
        topicId: a.topicId,
        text: a.text.trim(),
      })),
      submittedAt: new Date(),
    });

    await this.bumpProgress(sessionId);

    return this.toDto(created.toObject() as unknown as Record<string, unknown>);
  }

  private async bumpProgress(sessionId: string) {
    const session = await this.sessions.findById(sessionId);
    if (!session) return;

    const invited = Math.max(session.progress?.invited ?? 0, 1);
    const completed = (session.progress?.completed ?? 0) + 1;
    const percent = Math.min(100, Math.round((completed / invited) * 100));
    const health =
      percent >= 100 ? 'done' : percent < 40 ? 'behind' : ('on_track' as const);

    session.progress = {
      invited,
      completed,
      percent,
      health,
    };
    if (percent >= 100 && session.status === 'ongoing') {
      session.status = 'completed';
    }
    await session.save();
  }

  private toDto(d: Record<string, unknown>): SessionResponse {
    const submittedAt =
      d.submittedAt instanceof Date
        ? d.submittedAt.toISOString()
        : d.createdAt instanceof Date
          ? d.createdAt.toISOString()
          : new Date().toISOString();

    return {
      id: String(d._id),
      orgId: String(d.orgId),
      sessionId: String(d.sessionId),
      userId: String(d.userId),
      answers: Array.isArray(d.answers)
        ? (d.answers as SessionResponse['answers'])
        : [],
      submittedAt,
    };
  }
}
