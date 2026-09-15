import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import type { PermissionKey } from '@pulsefeedback/shared';
import { Organization, OrganizationDocument } from '../schemas/organization.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { Session, SessionDocument } from '../schemas/session.schema';
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

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    @InjectModel(Contact.name) private readonly contacts: Model<ContactDocument>,
    @InjectModel(ContactGroup.name) private readonly groups: Model<ContactGroupDocument>,
    @InjectModel(ReportTemplate.name)
    private readonly templates: Model<ReportTemplateDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureSystemTemplates();

    const existing = await this.orgs.findOne({ slug: 'acme' });
    if (existing) {
      await this.sessions.updateMany(
        { createdByName: { $in: [null, ''] } },
        { $set: { createdByName: 'Acme Admin' } },
      );
      await this.ensureOrgDirectory(String(existing._id));
      this.logger.log('Seed skipped org create — ensured contacts/templates');
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
      permissions: ['sessions:read', 'responses:write'],
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

    this.logger.log('Seeded Acme org — admin@acme.local / password123');
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