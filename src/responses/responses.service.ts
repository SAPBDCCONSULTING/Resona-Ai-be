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
import { SessionsService } from '../sessions/sessions.service';
import { SubmitResponseDto } from './dto/submit-response.dto';

@Injectable()
export class ResponsesService {
  constructor(
    @InjectModel(Response.name) private readonly responses: Model<ResponseDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    private readonly sessionsService: SessionsService,
  ) {}

  async listAssignments(userId: string, orgId: string): Promise<EmployeeAssignment[]> {
    // Soft-activate due scheduled sessions (stand-in for BullMQ start jobs).
    await this.sessions.updateMany(
      {
        orgId: new Types.ObjectId(orgId),
        status: 'scheduled',
        startAt: { $lte: new Date() },
        assignedUserIds: userId,
      },
      { $set: { status: 'ongoing' } },
    );

    const sessions = await this.sessions
      .find({
        orgId: new Types.ObjectId(orgId),
        status: { $in: ['ongoing', 'scheduled'] },
        assignedUserIds: userId,
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
      const type = s.type;
      return {
        id,
        title: s.title,
        type,
        status: s.status,
        endAt: s.endAt instanceof Date ? s.endAt.toISOString() : null,
        topicsCount: Array.isArray(s.topics) ? s.topics.length : 0,
        completedByMe: done.has(id),
        joinPath: sessionJoinPath({ id, type }),
      };
    });
  }

  async getMine(
    sessionId: string,
    userId: string,
  ): Promise<SessionResponse | null> {
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
    const activated = await this.sessionsService.softActivateIfDue(sessionId);
    if (!activated) throw new NotFoundException('Session not found');
    if (activated.orgId !== actor.orgId) {
      throw new ForbiddenException('Session is in another organization');
    }
    if (!this.sessionsService.acceptingResponses(activated)) {
      throw new BadRequestException(
        activated.status === 'scheduled'
          ? 'Session has not started yet'
          : 'Session is not open for responses',
      );
    }

    if (!activated.assignedUserIds.includes(actor.userId)) {
      throw new ForbiddenException('You are not assigned to this session');
    }

    const existing = await this.responses.findOne({
      sessionId: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(actor.userId),
    });
    if (existing) {
      throw new ConflictException(
        'You already submitted a response for this session',
      );
    }

    let created: ResponseDocument;
    try {
      created = await this.responses.create({
        orgId: new Types.ObjectId(actor.orgId),
        sessionId: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(actor.userId),
        answers: dto.answers.map((a) => ({
          topicId: a.topicId,
          text: a.text.trim(),
        })),
        submittedAt: new Date(),
      });
    } catch (err) {
      // Race backstop: two concurrent submits can both pass the findOne check above;
      // the unique (sessionId, userId) index rejects the second insert with code 11000.
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('You already submitted a response for this session');
      }
      throw err;
    }

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
