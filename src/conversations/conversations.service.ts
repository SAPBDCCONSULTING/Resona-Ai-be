import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  ConversationChatTurnResult,
  SessionConversation,
  SessionResponse,
  SessionTopic,
} from '@pulsefeedback/shared';
import { AiService } from '../ai/ai.service';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { SessionsService } from '../sessions/sessions.service';
import { ResponsesService } from '../responses/responses.service';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversations: Model<ConversationDocument>,
    private readonly sessionsService: SessionsService,
    private readonly responsesService: ResponsesService,
    private readonly ai: AiService,
  ) {}

  async getMine(
    sessionId: string,
    actor: { userId: string; orgId: string },
  ): Promise<SessionConversation | null> {
    const doc = await this.conversations
      .findOne({
        sessionId: new Types.ObjectId(sessionId),
        userId: new Types.ObjectId(actor.userId),
      })
      .lean();
    return doc ? this.toDto(doc as unknown as Record<string, unknown>) : null;
  }

  async start(
    sessionId: string,
    actor: { userId: string; orgId: string },
  ): Promise<SessionConversation> {
    const session = await this.requireOpenOneOnOne(sessionId, actor);

    const existingResponse = await this.responsesService.getMine(
      sessionId,
      actor.userId,
    );
    if (existingResponse) {
      throw new ConflictException('You already completed this session');
    }

    const existing = await this.conversations.findOne({
      sessionId: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(actor.userId),
    });
    if (existing) {
      if (existing.status === 'completed' || existing.status === 'expired') {
        throw new ConflictException('This conversation is already finished');
      }
      return this.toDto(existing.toObject() as unknown as Record<string, unknown>);
    }

    const welcome = session.welcomeMessage?.trim()
      ? session.welcomeMessage.trim()
      : this.ai.welcomeDiscussionMessage({
          title: session.participantTitle?.trim() || session.title,
          topics: session.topics,
          tone: session.tone,
        });
    const firstTopicId = this.sortedTopics(session.topics)[0]?.id ?? null;

    const created = await this.conversations.create({
      orgId: new Types.ObjectId(actor.orgId),
      sessionId: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(actor.userId),
      status: 'active',
      currentTopicIndex: 0,
      messages: [
        {
          role: 'assistant',
          content: welcome,
          topicId: firstTopicId,
          createdAt: new Date(),
        },
      ],
      topicSummaries: [],
      responseId: null,
    });

    return this.toDto(created.toObject() as unknown as Record<string, unknown>);
  }

  async chat(
    sessionId: string,
    actor: { userId: string; orgId: string },
    message: string,
  ): Promise<ConversationChatTurnResult> {
    const text = message.trim();
    if (!text) throw new BadRequestException('Message is required');

    const session = await this.requireOpenOneOnOne(sessionId, actor);
    const topics = this.sortedTopics(session.topics);

    let convo = await this.conversations.findOne({
      sessionId: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(actor.userId),
    });
    if (!convo) {
      throw new BadRequestException('Start the conversation first');
    }
    if (convo.status === 'completed' || convo.status === 'expired') {
      throw new ConflictException('This conversation is already finished');
    }

    const currentIndex = Math.min(
      Math.max(convo.currentTopicIndex ?? 0, 0),
      Math.max(topics.length - 1, 0),
    );
    const currentTopic = topics[currentIndex] ?? null;

    convo.messages.push({
      role: 'user',
      content: text,
      topicId: currentTopic?.id ?? null,
      createdAt: new Date(),
    });
    convo.status = 'active';

    const turn = await this.ai.employeeDiscussionTurn({
      title: session.title,
      goalPrompt: session.goalPrompt,
      tone: session.tone,
      topics,
      currentTopicIndex: currentIndex,
      messages: convo.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      orgId: actor.orgId,
    });

    if (turn.topicComplete && turn.topicSummary && currentTopic) {
      const already = convo.topicSummaries.some((s) => s.topicId === currentTopic.id);
      if (!already) {
        convo.topicSummaries.push({
          topicId: currentTopic.id,
          text: turn.topicSummary,
        });
      }
    }

    const nextIndex = turn.agendaComplete
      ? currentIndex
      : turn.topicComplete
        ? Math.min(turn.currentTopicIndex, topics.length - 1)
        : currentIndex;

    convo.currentTopicIndex = nextIndex;
    const nextTopic = topics[nextIndex] ?? currentTopic;

    convo.messages.push({
      role: 'assistant',
      content: turn.assistantMessage,
      topicId: nextTopic?.id ?? null,
      createdAt: new Date(),
    });

    let response: SessionResponse | null = null;
    if (turn.agendaComplete) {
      // Ensure every topic has a summary before submitting.
      for (const t of topics) {
        if (!convo.topicSummaries.some((s) => s.topicId === t.id)) {
          convo.topicSummaries.push({
            topicId: t.id,
            text: 'Discussed during the AI 1:1 conversation.',
          });
        }
      }
      response = await this.responsesService.submit(
        sessionId,
        actor,
        {
          answers: convo.topicSummaries.map((s) => ({
            topicId: s.topicId,
            text: s.text,
          })),
        },
      );
      convo.status = 'completed';
      convo.responseId = new Types.ObjectId(response.id);
    }

    await convo.save();

    const conversation = this.toDto(
      convo.toObject() as unknown as Record<string, unknown>,
    );

    return {
      conversation,
      assistantMessage: turn.assistantMessage,
      currentTopicIndex: conversation.currentTopicIndex,
      currentTopicTitle: topics[conversation.currentTopicIndex]?.title ?? null,
      topicComplete: turn.topicComplete,
      agendaComplete: turn.agendaComplete,
      response,
    };
  }

  private async requireOpenOneOnOne(
    sessionId: string,
    actor: { userId: string; orgId: string },
  ) {
    const activated = await this.sessionsService.softActivateIfDue(sessionId);
    if (!activated) throw new NotFoundException('Session not found');
    if (activated.orgId !== actor.orgId) {
      throw new ForbiddenException('Session is in another organization');
    }
    if (activated.type !== 'one_on_one') {
      throw new BadRequestException('AI chat is only for 1:1 sessions');
    }
    if (!this.sessionsService.acceptingResponses(activated)) {
      throw new BadRequestException(
        activated.status === 'scheduled'
          ? 'Session has not started yet'
          : 'Session is not open for responses',
      );
    }
    if (!activated.participantIds.includes(actor.userId)) {
      throw new ForbiddenException('You are not assigned to this session');
    }
    return activated;
  }

  private sortedTopics(topics: SessionTopic[]): SessionTopic[] {
    return [...(topics ?? [])].sort((a, b) => a.order - b.order);
  }

  private toDto(d: Record<string, unknown>): SessionConversation {
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    const updatedAt =
      d.updatedAt instanceof Date ? d.updatedAt.toISOString() : createdAt;

    return {
      id: String(d._id),
      orgId: String(d.orgId),
      sessionId: String(d.sessionId),
      userId: String(d.userId),
      status: d.status as SessionConversation['status'],
      currentTopicIndex: typeof d.currentTopicIndex === 'number' ? d.currentTopicIndex : 0,
      messages: Array.isArray(d.messages)
        ? (d.messages as Array<Record<string, unknown>>).map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: String(m.content ?? ''),
            topicId: m.topicId ? String(m.topicId) : null,
            createdAt:
              m.createdAt instanceof Date
                ? m.createdAt.toISOString()
                : createdAt,
          }))
        : [],
      topicSummaries: Array.isArray(d.topicSummaries)
        ? (d.topicSummaries as SessionConversation['topicSummaries'])
        : [],
      responseId: d.responseId ? String(d.responseId) : null,
      createdAt,
      updatedAt,
    };
  }
}
