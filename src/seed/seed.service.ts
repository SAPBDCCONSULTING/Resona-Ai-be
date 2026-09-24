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

const RESONAAI_PROFILE = {
  address: '1710 Greenwood Road, Pleasanton CA 94566',
  country: 'United States',
  description:
    'Resona AI runs AI-assisted employee feedback — 1:1s, focus groups, and surveys that help leaders listen, learn, and act.',
  website: 'www.resonaai.example',
  domain: 'hello@resonaai.local',
  phone: '+1 925-640-6315',
  timezone: 'Los Angeles (PDT)',
  foundedYear: '2025',
  logoUrl: null as string | null,
  accentColor: '#2f5d4a',
  accentSoft: '#d9ebe2',
  tagline: 'Listen · Learn · Act',
  aiSystemPrompt:
    'Stay professional. Do not ask about protected health details or personal finances.',
  blockedTopics: ['salary negotiations', 'medical diagnoses'],
  piiRedactionEnabled: true,
  retentionDays: 365,
  archiveAfterDays: 90,
  softDeleteEnabled: true,
};

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

    const existing = await this.orgs.findOne({ slug: { $in: ['acme', 'resonaai'] } });
    if (existing) {
      await this.migrateAcmeToResonaai(existing._id as Types.ObjectId);
      await this.orgs.updateOne(
        { _id: existing._id },
        {
          $set: {
            name: 'Resona AI',
            slug: 'resonaai',
            address: existing.address ?? RESONAAI_PROFILE.address,
            country: existing.country ?? RESONAAI_PROFILE.country,
            description: RESONAAI_PROFILE.description,
            website: RESONAAI_PROFILE.website,
            domain: RESONAAI_PROFILE.domain,
            phone: existing.phone ?? RESONAAI_PROFILE.phone,
            timezone: existing.timezone ?? RESONAAI_PROFILE.timezone,
            foundedYear: existing.foundedYear ?? RESONAAI_PROFILE.foundedYear,
            logoUrl: existing.logoUrl ?? RESONAAI_PROFILE.logoUrl,
            accentColor: existing.accentColor ?? RESONAAI_PROFILE.accentColor,
            accentSoft: existing.accentSoft ?? RESONAAI_PROFILE.accentSoft,
            tagline: existing.tagline ?? RESONAAI_PROFILE.tagline,
            aiSystemPrompt: existing.aiSystemPrompt ?? RESONAAI_PROFILE.aiSystemPrompt,
            blockedTopics:
              existing.blockedTopics?.length
                ? existing.blockedTopics
                : RESONAAI_PROFILE.blockedTopics,
            piiRedactionEnabled:
              existing.piiRedactionEnabled ?? RESONAAI_PROFILE.piiRedactionEnabled,
            retentionDays: existing.retentionDays ?? RESONAAI_PROFILE.retentionDays,
            archiveAfterDays: existing.archiveAfterDays ?? RESONAAI_PROFILE.archiveAfterDays,
            softDeleteEnabled: existing.softDeleteEnabled ?? RESONAAI_PROFILE.softDeleteEnabled,
          },
        },
      );
      await this.sessions.updateMany(
        { createdByName: { $in: [null, '', 'Acme Admin'] } },
        { $set: { createdByName: 'Resona Admin' } },
      );
      await this.ensureOrgDirectory(String(orgId));
      await this.ensureDemoUsers(orgId);
      await this.ensureEmployeeAssignments(orgId);
      await this.ensureDemoCampaign(orgId);
      this.logger.log('Seed skipped org create — ensured contacts/templates/users/campaigns/profile');
      return;
    }

    const org = await this.orgs.create({
      name: 'Resona AI',
      slug: 'resonaai',
      ...RESONAAI_PROFILE,
    });
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
      email: 'admin@resonaai.local',
      name: 'Resona Admin',
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
      'Seeded Resona AI org — admin@resonaai.local / employee@resonaai.local / analyst@resonaai.local (password123)',
    );
  }

  /** Rename legacy @acme.local demo accounts to @resonaai.local. */
  private async migrateAcmeToResonaai(orgId: Types.ObjectId) {
    const renames: Array<{ from: string; to: string; name: string }> = [
      { from: 'admin@acme.local', to: 'admin@resonaai.local', name: 'Resona Admin' },
      { from: 'employee@acme.local', to: 'employee@resonaai.local', name: 'Resona Employee' },
      { from: 'analyst@acme.local', to: 'analyst@resonaai.local', name: 'Resona Analyst' },
    ];
    for (const { from, to, name } of renames) {
      await this.users.updateOne({ orgId, email: from }, { $set: { email: to, name } });
    }
    await this.users.updateOne(
      { orgId, email: 'admin@resonaai.local', name: { $in: ['Acme Admin', ''] } },
      { $set: { name: 'Resona Admin' } },
    );
    await this.contacts.updateMany(
      { orgId, email: /@acme\.local$/ },
      [{ $set: { email: { $replaceAll: { input: '$email', find: '@acme.local', replacement: '@resonaai.local' } } } }],
    );
  }

  /** Rename legacy @acme.local demo accounts to @resonaai.local (idempotent). */
  private async migrateAcmeToResonaai(orgId: Types.ObjectId) {
    const renames: Array<{ from: string; to: string; name: string }> = [
      { from: 'admin@acme.local', to: 'admin@resonaai.local', name: 'Resona Admin' },
      { from: 'employee@acme.local', to: 'employee@resonaai.local', name: 'Resona Employee' },
      { from: 'analyst@acme.local', to: 'analyst@resonaai.local', name: 'Resona Analyst' },
    ];
    for (const { from, to, name } of renames) {
      // email is globally unique — don't scope by orgId
      const legacy = await this.users.findOne({ email: from });
      if (!legacy) continue;

      const already = await this.users.findOne({ email: to });
      if (already) {
        await this.users.deleteOne({ _id: legacy._id });
        this.logger.log(`Seed migrate: removed leftover ${from} (kept ${to})`);
        continue;
      }

      await this.users.updateOne(
        { _id: legacy._id },
        { $set: { email: to, name, orgId } },
      );
    }
    await this.users.updateOne(
      { email: 'admin@resonaai.local', name: { $in: ['Acme Admin', ''] } },
      { $set: { name: 'Resona Admin' } },
    );

    const legacyContacts = await this.contacts.find({ email: /@acme\.local$/i }).lean();
    for (const c of legacyContacts) {
      const nextEmail = String(c.email).toLowerCase().replace(/@acme\.local$/i, '@resonaai.local');
      const clash = await this.contacts.findOne({
        orgId: c.orgId ?? orgId,
        email: nextEmail,
      });
      if (clash) {
        await this.contacts.deleteOne({ _id: c._id });
        continue;
      }
      await this.contacts.updateOne(
        { _id: c._id },
        { $set: { email: nextEmail, orgId } },
      );
    }
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
      { email: 'employee@resonaai.local' },
      {
        $setOnInsert: {
          orgId,
          email: 'employee@resonaai.local',
          name: 'Resona Employee',
          passwordHash: hash,
          roleId: employeeRole!._id,
          locale: 'en',
        },
      },
      { upsert: true },
    );

    await this.users.findOneAndUpdate(
      { email: 'analyst@resonaai.local' },
      {
        $setOnInsert: {
          orgId,
          email: 'analyst@resonaai.local',
          name: 'Resona Analyst',
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
    const employee = await this.users.findOne({ email: 'employee@resonaai.local' });
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

    const admin = await this.users.findOne({ email: 'admin@resonaai.local' });
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
          email: 'aarav@resonaai.local',
          department: 'Engineering',
          groupIds: [eng._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Priya Nair',
          email: 'priya@resonaai.local',
          department: 'Engineering',
          groupIds: [eng._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Sam Chen',
          email: 'sam@resonaai.local',
          department: 'Engineering',
          groupIds: [eng._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Maya Lopez',
          email: 'maya@resonaai.local',
          department: 'People Ops',
          groupIds: [people._id],
          contactType: 'employee',
        },
        {
          orgId: orgObjectId,
          name: 'Jordan Lee',
          email: 'jordan@resonaai.local',
          department: 'People Ops',
          groupIds: [people._id],
          contactType: 'employee',
        },
      ]);
    }
  }
}
