import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Contact as ContactDto, ContactGroup as GroupDto } from '@pulsefeedback/shared';
import {
  Contact,
  ContactDocument,
  ContactGroup,
  ContactGroupDocument,
} from '../schemas/contact.schema';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact.name) private readonly contacts: Model<ContactDocument>,
    @InjectModel(ContactGroup.name) private readonly groups: Model<ContactGroupDocument>,
  ) {}

  async listContacts(orgId: string, search?: string, groupId?: string) {
    const filter: Record<string, unknown> = { orgId: new Types.ObjectId(orgId) };
    if (groupId) filter.groupIds = new Types.ObjectId(groupId);
    if (search?.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
      ];
    }
    const docs = await this.contacts.find(filter).sort({ name: 1 }).limit(200).lean();
    return { items: docs.map((d) => this.toContact(d)) };
  }

  async listGroups(orgId: string) {
    const docs = await this.groups.find({ orgId: new Types.ObjectId(orgId) }).sort({ name: 1 }).lean();
    return { items: docs.map((d) => this.toGroup(d)) };
  }

  async importCsv(orgId: string, csv: string) {
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return { imported: 0, items: [] as ContactDto[] };

    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('email') || header.includes('name');
    const rows = hasHeader ? lines.slice(1) : lines;
    const created: ContactDto[] = [];

    for (const row of rows) {
      const parts = row.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      if (parts.length < 2) continue;
      const [name, email, department] = parts;
      if (!email || !email.includes('@')) continue;
      const doc = await this.contacts.findOneAndUpdate(
        { orgId: new Types.ObjectId(orgId), email: email.toLowerCase() },
        {
          $set: {
            name: name || email.split('@')[0],
            department: department || null,
            contactType: 'employee',
          },
          $setOnInsert: {
            orgId: new Types.ObjectId(orgId),
            groupIds: [],
          },
        },
        { upsert: true, new: true },
      );
      created.push(this.toContact(doc.toObject() as unknown as Record<string, unknown>));
    }

    return { imported: created.length, items: created };
  }

  async exportCsv(orgId: string): Promise<string> {
    const docs = await this.contacts
      .find({ orgId: new Types.ObjectId(orgId) })
      .sort({ name: 1 })
      .lean();
    const escape = (v: string) => {
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = ['name,email,department'];
    for (const d of docs) {
      lines.push(
        [
          escape(String(d.name ?? '')),
          escape(String(d.email ?? '')),
          escape(String(d.department ?? '')),
        ].join(','),
      );
    }
    return lines.join('\n') + '\n';
  }

  async createContact(orgId: string, dto: CreateContactDto): Promise<ContactDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const email = this.normalizeEmail(dto.email);

    const clash = await this.contacts.findOne({ orgId: orgObjectId, email }).lean();
    if (clash) throw new ConflictException('A contact with this email already exists');

    try {
      const doc = await this.contacts.create({
        orgId: orgObjectId,
        name: dto.name.trim(),
        email,
        department: dto.department?.trim() || null,
        groupIds: [],
        contactType: dto.contactType ?? 'employee',
      });
      return this.toContact(doc.toObject() as unknown as Record<string, unknown>);
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException('A contact with this email already exists');
      }
      throw err;
    }
  }

  async getContact(orgId: string, id: string): Promise<ContactDto> {
    this.assertValidId(id, 'contact');
    const doc = await this.contacts
      .findOne({ _id: new Types.ObjectId(id), orgId: new Types.ObjectId(orgId) })
      .lean();
    if (!doc) throw new NotFoundException('Contact not found');
    return this.toContact(doc);
  }

  async updateContact(
    orgId: string,
    id: string,
    dto: UpdateContactDto,
  ): Promise<ContactDto> {
    this.assertValidId(id, 'contact');
    const orgObjectId = new Types.ObjectId(orgId);
    const contactObjectId = new Types.ObjectId(id);

    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.email !== undefined) update.email = this.normalizeEmail(dto.email);
    if (dto.department !== undefined) update.department = dto.department?.trim() || null;
    if (dto.contactType !== undefined) update.contactType = dto.contactType;

    if (Object.keys(update).length === 0) return this.getContact(orgId, id);

    if (typeof update.email === 'string') {
      const clash = await this.contacts
        .findOne({
          orgId: orgObjectId,
          email: update.email,
          _id: { $ne: contactObjectId },
        })
        .lean();
      if (clash) throw new ConflictException('A contact with this email already exists');
    }

    try {
      const doc = await this.contacts
        .findOneAndUpdate(
          { _id: contactObjectId, orgId: orgObjectId },
          { $set: update },
          { new: true },
        )
        .lean();
      if (!doc) throw new NotFoundException('Contact not found');
      return this.toContact(doc);
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException('A contact with this email already exists');
      }
      throw err;
    }
  }

  async deleteContact(orgId: string, id: string): Promise<{ id: string; deleted: true }> {
    this.assertValidId(id, 'contact');
    const orgObjectId = new Types.ObjectId(orgId);

    const doc = await this.contacts
      .findOneAndDelete({ _id: new Types.ObjectId(id), orgId: orgObjectId })
      .lean();
    if (!doc) throw new NotFoundException('Contact not found');

    // Membership lives on the contact, so the row is already gone — only the
    // cached memberCount on each of its groups still needs correcting.
    const groupIds = Array.isArray(doc.groupIds) ? doc.groupIds : [];
    for (const groupId of groupIds) {
      await this.recalcMemberCount(orgObjectId, new Types.ObjectId(String(groupId)));
    }

    return { id, deleted: true };
  }

  async createGroup(orgId: string, dto: CreateGroupDto): Promise<GroupDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const name = dto.name.trim();

    const clash = await this.groups.findOne({ orgId: orgObjectId, name }).lean();
    if (clash) throw new ConflictException('A group with this name already exists');

    try {
      const doc = await this.groups.create({
        orgId: orgObjectId,
        name,
        memberCount: 0,
      });
      return this.toGroup(doc.toObject() as unknown as Record<string, unknown>);
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException('A group with this name already exists');
      }
      throw err;
    }
  }

  async updateGroup(orgId: string, id: string, dto: UpdateGroupDto): Promise<GroupDto> {
    this.assertValidId(id, 'group');
    const orgObjectId = new Types.ObjectId(orgId);
    const groupObjectId = new Types.ObjectId(id);
    const name = dto.name.trim();

    const clash = await this.groups
      .findOne({ orgId: orgObjectId, name, _id: { $ne: groupObjectId } })
      .lean();
    if (clash) throw new ConflictException('A group with this name already exists');

    try {
      const doc = await this.groups
        .findOneAndUpdate(
          { _id: groupObjectId, orgId: orgObjectId },
          { $set: { name } },
          { new: true },
        )
        .lean();
      if (!doc) throw new NotFoundException('Group not found');
      return this.toGroup(doc);
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException('A group with this name already exists');
      }
      throw err;
    }
  }

  async deleteGroup(orgId: string, id: string): Promise<{ id: string; deleted: true }> {
    this.assertValidId(id, 'group');
    const orgObjectId = new Types.ObjectId(orgId);
    const groupObjectId = new Types.ObjectId(id);

    const doc = await this.groups
      .findOneAndDelete({ _id: groupObjectId, orgId: orgObjectId })
      .lean();
    if (!doc) throw new NotFoundException('Group not found');

    await this.contacts.updateMany(
      { orgId: orgObjectId, groupIds: groupObjectId },
      { $pull: { groupIds: groupObjectId } },
    );

    return { id, deleted: true };
  }

  async addGroupMembers(
    orgId: string,
    groupId: string,
    contactIds: string[],
  ): Promise<GroupDto> {
    this.assertValidId(groupId, 'group');
    const orgObjectId = new Types.ObjectId(orgId);
    const groupObjectId = new Types.ObjectId(groupId);

    const group = await this.groups
      .findOne({ _id: groupObjectId, orgId: orgObjectId })
      .lean();
    if (!group) throw new NotFoundException('Group not found');

    const ids = contactIds.map((cid) => {
      this.assertValidId(cid, 'contact');
      return new Types.ObjectId(cid);
    });

    const found = await this.contacts.countDocuments({
      _id: { $in: ids },
      orgId: orgObjectId,
    });
    if (found !== ids.length) {
      throw new NotFoundException('One or more contacts were not found in this organization');
    }

    // $addToSet only adds the group when it is not already present.
    await this.contacts.updateMany(
      { _id: { $in: ids }, orgId: orgObjectId },
      { $addToSet: { groupIds: groupObjectId } },
    );

    const memberCount = await this.recalcMemberCount(orgObjectId, groupObjectId);
    return this.toGroup({ ...group, memberCount });
  }

  async removeGroupMember(
    orgId: string,
    groupId: string,
    contactId: string,
  ): Promise<GroupDto> {
    this.assertValidId(groupId, 'group');
    this.assertValidId(contactId, 'contact');
    const orgObjectId = new Types.ObjectId(orgId);
    const groupObjectId = new Types.ObjectId(groupId);

    const group = await this.groups
      .findOne({ _id: groupObjectId, orgId: orgObjectId })
      .lean();
    if (!group) throw new NotFoundException('Group not found');

    const contact = await this.contacts
      .findOne({ _id: new Types.ObjectId(contactId), orgId: orgObjectId })
      .lean();
    if (!contact) throw new NotFoundException('Contact not found');

    await this.contacts.updateOne(
      { _id: new Types.ObjectId(contactId), orgId: orgObjectId },
      { $pull: { groupIds: groupObjectId } },
    );

    const memberCount = await this.recalcMemberCount(orgObjectId, groupObjectId);
    return this.toGroup({ ...group, memberCount });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private assertValidId(id: string, label: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label} id`);
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
    );
  }

  /** Counts the real members and stores the result, so the cache cannot drift. */
  private async recalcMemberCount(
    orgObjectId: Types.ObjectId,
    groupObjectId: Types.ObjectId,
  ): Promise<number> {
    const memberCount = await this.contacts.countDocuments({
      orgId: orgObjectId,
      groupIds: groupObjectId,
    });
    await this.groups.updateOne(
      { _id: groupObjectId, orgId: orgObjectId },
      { $set: { memberCount } },
    );
    return memberCount;
  }

  private toContact(d: Record<string, unknown>): ContactDto {
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      name: String(d.name),
      email: String(d.email),
      department: (d.department as string | null) ?? null,
      groupIds: Array.isArray(d.groupIds) ? d.groupIds.map(String) : [],
      contactType: (d.contactType as ContactDto['contactType']) ?? 'employee',
      createdAt:
        d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString(),
    };
  }

  private toGroup(d: Record<string, unknown>): GroupDto {
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      name: String(d.name),
      memberCount: Number(d.memberCount ?? 0),
      createdAt:
        d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString(),
    };
  }
}
