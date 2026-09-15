import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import type { PermissionKey } from '@pulsefeedback/shared';
import { Organization, OrganizationDocument } from '../schemas/organization.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import {
  Campaign,
  CampaignDocument,
  Session,
  SessionDocument,
} from '../schemas/session.schema';
import {
  Contact,
  ContactDocument,
  ContactGroup,
  ContactGroupDocument,
} from '../schemas/contact.schema';
import {
  ReportTemplate,
  ReportTemplateDocument,
} from '../schemas/report-template.schema';
import {
  SessionTemplate,
  SessionTemplateDocument,
} from '../schemas/session-template.schema';

const ADMIN_PERMS: PermissionKey[] = [
  'org:read',
  'org:write',
  'users:read',
  'users:write',
  'roles:read',
  'roles:write',
  'contacts:read',
  'contacts:write',
  'contacts:import',
  'sessions:read',
  'sessions:write',
  'sessions:launch',
  'sessions:archive',
  'campaigns:read',
  'campaigns:write',
  'templates:read',
  'templates:write',
  'reports:read',
  'reports:export',
  'ai:use',
  'settings:read',
  'settings:write',
];

/** Read-only dashboard role — used to prove 403 on sessions:write. */
const ANALYST_PERMS: PermissionKey[] = [
  'org:read',
  'contacts:read',
  'sessions:read',
  'campaigns:read',
  'templates:read',
  'reports:read',
  'settings:read',
];

const EMPLOYEE_PERMS: PermissionKey[] = ['sessions:read', 'responses:write'];

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    @InjectModel(Campaign.name) private readonly campaigns: Model<CampaignDocument>,
    @InjectModel(Contact.name) private readonly contacts: Model<ContactDocument>,
    @InjectModel(ContactGroup.name) private readonly groups: Model<ContactGroupDocument>,
    @InjectModel(ReportTemplate.name)
    private readonly templates: Model<ReportTemplateDocument>,
    @InjectModel(SessionTemplate.name)
    private readonly sessionTemplates: Model<SessionTemplateDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureSystemTemplates();
    await this.ensureSessionOutlineTemplates();

    const existing = await this.orgs.findOne({ slug: 'acme' });
    if (existing) {
      await this.sessions.updateMany(
        { createdByName: { $in: [null, ''] } },
        { $set: { createdByName: 'Acme Admin' } },
      );
      await this.ensureOrgDirectory(String(existing._id));
      await this.ensureDemoUsers(existing._id as Types.ObjectId);
      await this.ensureEmployeeAssignments(existing._id as Types.ObjectId);
      await this.ensureDemoCampaign(existing._id as Types.ObjectId);
      this.logger.log('Seed skipped org create — ensured contacts/templates/users/campaigns');
      return;
    }

    const org = await this.orgs.create({ name: 'Acme Corp', slug: 'acme' });
    const adminRole = await this.roles.create({
      orgId: org._id,
      name: 'Admin',
      permissions: ADMIN_PERMS,
    });
    await this.roles.create({
      orgId: org._id,
      name: 'Employee',
      permissions: EMPLOYEE_PERMS,
    });
    await this.roles.create({
      orgId: org._id,
      name: 'Analyst',
      permissions: ANALYST_PERMS,
    });

    const passwordHash = await bcrypt.hash('password123', 10);
    const admin = await this.users.create({
      orgId: org._id,
      email: 'admin@acme.local',
      name: 'Acme Admin',
      passwordHash,
      roleId: adminRole._id,
      locale: 'en',
    });

    await this.ensureDemoUsers(org._id as Types.ObjectId, passwordHash);
    await this.ensureOrgDirectory(String(org._id));

    await this.sessions.insertMany([
      {
        orgId: org._id,
        title: 'Onboarding Support & Belonging',
        type: 'one_on_one',
        status: 'ongoing',
        startAt: new Date(),
        endAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        createdBy: admin._id,
        createdByName: admin.name,
        campaignId: null,
        progress: { invited: 12, completed: 4, percent: 33, health: 'on_track' },
        favorite: true,
        topics: [
          { id: 't1', title: 'First-week experience', order: 1 },
          { id: 't2', title: 'Belonging & support', order: 2 },
        ],
        goalPrompt: 'Understand how new hires feel supported in their first 30 days.',
        wizardStep: 'schedule',
        entryMode: 'blank',
      },
      {
        orgId: org._id,
        title: 'Q3 Engagement Pulse',
        type: 'survey',
        status: 'ongoing',
        startAt: new Date(),
        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: admin._id,
        createdByName: admin.name,
        campaignId: null,
        progress: { invited: 240, completed: 88, percent: 37, health: 'behind' },
        favorite: false,
        topics: [
          { id: 't1', title: 'Loyalty drivers', order: 1 },
          { id: 't2', title: 'Team communication', order: 2 },
        ],
        goalPrompt: 'Measure engagement and loyalty across the org.',
        wizardStep: 'schedule',
        entryMode: 'blank',
      },
    ]);

    await this.ensureEmployeeAssignments(org._id as Types.ObjectId);
    await this.ensureDemoCampaign(org._id as Types.ObjectId);

    this.logger.log(
      'Seeded Acme org — admin@acme.local / employee@acme.local / analyst@acme.local (password123)',
    );
  }

  private async ensureDemoUsers(orgId: Types.ObjectId, passwordHash?: string) {
    const hash = passwordHash ?? (await bcrypt.hash('password123', 10));

    const employeeRole = await this.roles.findOneAndUpdate(
      { orgId, name: 'Employee' },
      { $setOnInsert: { orgId, name: 'Employee', permissions: EMPLOYEE_PERMS } },
      { upsert: true, new: true },
    );
    const analystRole = await this.roles.findOneAndUpdate(
      { orgId, name: 'Analyst' },
      { $setOnInsert: { orgId, name: 'Analyst', permissions: ANALYST_PERMS } },
      { upsert: true, new: true },
    );
    await this.roles.findOneAndUpdate(
      { orgId, name: 'Admin' },
      { $setOnInsert: { orgId, name: 'Admin', permissions: ADMIN_PERMS } },
      { upsert: true, new: true },
    );

    await this.users.findOneAndUpdate(
      { email: 'employee@acme.local' },
      {
        $setOnInsert: {
          orgId,
          email: 'employee@acme.local',
          name: 'Acme Employee',
          passwordHash: hash,
          roleId: employeeRole!._id,
          locale: 'en',
        },
      },
      { upsert: true },
    );

    await this.users.findOneAndUpdate(
      { email: 'analyst@acme.local' },
      {
        $setOnInsert: {
          orgId,
          email: 'analyst@acme.local',
          name: 'Acme Analyst',
          passwordHash: hash,
          roleId: analystRole!._id,
          locale: 'en',
        },
      },
      { upsert: true },
    );
  }

  /** Assign employee user to open sessions so Phase 2 take/submit works. */
  private async ensureEmployeeAssignments(orgId: Types.ObjectId) {
    const employee = await this.users.findOne({ email: 'employee@acme.local' });
    if (!employee) return;

    const userId = String(employee._id);
    const open = await this.sessions.find({
      orgId,
      status: { $in: ['ongoing', 'scheduled'] },
    });

    const defaultTopics: Record<string, { id: string; title: string; order: number }[]> = {
      one_on_one: [
        { id: 't1', title: 'First-week experience', order: 1 },
        { id: 't2', title: 'Belonging & support', order: 2 },
      ],
      survey: [
        { id: 't1', title: 'Loyalty drivers', order: 1 },
        { id: 't2', title: 'Team communication', order: 2 },
      ],
    };

    for (const session of open) {
      const ids = Array.isArray(session.participantIds) ? [...session.participantIds] : [];
      let dirty = false;
      if (!ids.includes(userId)) {
        ids.push(userId);
        session.participantIds = ids;
        dirty = true;
      }
      if (!Array.isArray(session.topics) || session.topics.length === 0) {
        session.topics = defaultTopics[String(session.type)] ?? defaultTopics.survey;
        dirty = true;
      }
      if (dirty) {
        session.progress = {
          invited: Math.max(session.progress?.invited ?? 0, ids.length),
          completed: session.progress?.completed ?? 0,
          percent: session.progress?.percent ?? 0,
          health: session.progress?.health ?? 'on_track',
        };
        await session.save();
      }
    }
  }

  private async ensureSystemTemplates() {
    const count = await this.templates.countDocuments({ orgId: null });
    if (count > 0) return;
    await this.templates.insertMany([
      {
        orgId: null,
        name: 'Executive summary',
        description: 'High-level themes, quotes, and recommended actions.',
        kind: 'summary',
        sessionTypes: ['one_on_one', 'survey'],
      },
      {
        orgId: null,
        name: 'Theme deep-dive',
        description: 'Clustered themes with frequency and sentiment.',
        kind: 'themes',
        sessionTypes: ['one_on_one', 'survey'],
      },
      {
        orgId: null,
        name: 'Scorecard',
        description: 'Numeric scores and trend-ready metrics for surveys.',
        kind: 'scores',
        sessionTypes: ['survey'],
      },
    ]);
  }

  private async ensureSessionOutlineTemplates() {
    const count = await this.sessionTemplates.countDocuments({ orgId: null });
    if (count > 0) return;
    await this.sessionTemplates.insertMany([
      {
        orgId: null,
        name: 'Manager 1:1 outline',
        description: 'Classic bi-weekly check-in covering wins, blockers, and growth.',
        sessionType: 'one_on_one',
        goalPrompt: 'Build trust and surface blockers in a private 1:1.',
        tone: 'supportive',
        topics: [
          { id: 't1', title: 'Wins since last time', order: 1 },
          { id: 't2', title: 'Blockers & support needed', order: 2 },
          { id: 't3', title: 'Career / growth', order: 3 },
        ],
      },
      {
        orgId: null,
        name: 'Engagement pulse survey',
        description: 'Short recurring survey for loyalty, clarity, and workload.',
        sessionType: 'survey',
        goalPrompt: 'Track engagement trends across the org each quarter.',
        tone: 'neutral',
        topics: [
          { id: 't1', title: 'Clarity of priorities', order: 1 },
          { id: 't2', title: 'Workload balance', order: 2 },
          { id: 't3', title: 'Likelihood to recommend', order: 3 },
        ],
      },
      {
        orgId: null,
        name: 'Onboarding check-in',
        description: '30/60/90 day 1:1 for new hires.',
        sessionType: 'one_on_one',
        goalPrompt: 'Understand belonging and support in the first 90 days.',
        tone: 'warm',
        topics: [
          { id: 't1', title: 'First impressions', order: 1 },
          { id: 't2', title: 'Tools & enablement', order: 2 },
          { id: 't3', title: 'Belonging', order: 3 },
        ],
      },
    ]);
  }

  /** Phase 3 exit: one recurring campaign with 3 sessions on the board. */
  private async ensureDemoCampaign(orgId: Types.ObjectId) {
    const existing = await this.campaigns.findOne({
      orgId,
      title: 'Quarterly Engagement Pulse',
    });
    if (existing) return;

    const admin = await this.users.findOne({ email: 'admin@acme.local' });
    if (!admin) return;

    const surveyTpl = await this.sessionTemplates.findOne({
      orgId: null,
      name: 'Engagement pulse survey',
    });

    const campaign = await this.campaigns.create({
      orgId,
      title: 'Quarterly Engagement Pulse',
      type: 'recurring',
      status: 'ongoing',
      startAt: new Date(),
      endAt: new Date(Date.now() + 42 * 24 * 60 * 60 * 1000),
      createdBy: admin._id,
      createdByName: admin.name,
      cadence: 'quarterly',
      sessionTemplateId: surveyTpl?._id ?? null,
      sessionsCompleted: 0,
      sessionsTotal: 3,
      percent: 0,
      health: 'on_track',
    });

    const topics = surveyTpl?.topics?.length
      ? surveyTpl.topics
      : [
          { id: 't1', title: 'Clarity of priorities', order: 1 },
          { id: 't2', title: 'Workload balance', order: 2 },
          { id: 't3', title: 'Likelihood to recommend', order: 3 },
        ];

    const windowMs = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    await this.sessions.insertMany(
      [1, 2, 3].map((round) => {
        const startAt = new Date(now + (round - 1) * windowMs);
        const endAt = new Date(startAt.getTime() + windowMs - 24 * 60 * 60 * 1000);
        return {
          orgId,
          title: `Quarterly Engagement Pulse — Round ${round}`,
          type: 'survey',
          status: round === 1 ? 'ongoing' : 'scheduled',
          startAt,
          endAt,
          createdBy: admin._id,
          createdByName: admin.name,
          campaignId: campaign._id,
          progress: {
            invited: 50,
            completed: round === 1 ? 12 : 0,
            percent: round === 1 ? 24 : 0,
            health: round === 1 ? 'on_track' : 'no_schedule',
          },
          favorite: false,
          topics,
          goalPrompt: surveyTpl?.goalPrompt ?? 'Track engagement trends across the org.',
          wizardStep: 'schedule',
          entryMode: 'blank',
          tone: surveyTpl?.tone ?? 'neutral',
          reportTemplateId: null,
          participantIds: [],
        };
      }),
    );

    this.logger.log('Seeded recurring campaign with 3 sessions');
  }

  private async ensureOrgDirectory(orgId: string) {
    const orgObjectId = new Types.ObjectId(orgId);
    const groupCount = await this.groups.countDocuments({ orgId: orgObjectId });
    if (groupCount === 0) {
      const eng = await this.groups.create({
        orgId: orgObjectId,
        name: 'Engineering',
        memberCount: 3,
      });
      const people = await this.groups.create({
        orgId: orgObjectId,
        name: 'People Ops',
        memberCount: 2,
      });

      await this.contacts.insertMany([
        {
          orgId: orgObjectId,
          name: 'Aarav Sharma',
          email: 'aarav@acme.local',
          department: 'Engineering',
          groupIds: [eng._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Priya Nair',
          email: 'priya@acme.local',
          department: 'Engineering',
          groupIds: [eng._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Sam Chen',
          email: 'sam@acme.local',
          department: 'Engineering',
          groupIds: [eng._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Maya Lopez',
          email: 'maya@acme.local',
          department: 'People Ops',
          groupIds: [people._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Jordan Lee',
          email: 'jordan@acme.local',
          department: 'People Ops',
          groupIds: [people._id],
          contactType: 'employee',
        },
      ]);
    }
  }
}
