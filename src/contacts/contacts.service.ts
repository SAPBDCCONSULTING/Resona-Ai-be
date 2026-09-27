import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  Contact as ContactDto,
  ContactGroup as GroupDto,
} from '@pulsefeedback/shared';
import {
  Contact,
  ContactDocument,
  ContactGroup,
  ContactGroupDocument,
} from '../schemas/contact.schema';

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contacts: Model<ContactDocument>,
    @InjectModel(ContactGroup.name)
    private readonly groups: Model<ContactGroupDocument>,
  ) {}

  async listContacts(orgId: string, search?: string, groupId?: string) {
    const filter: Record<string, unknown> = {
      orgId: new Types.ObjectId(orgId),
    };
    if (groupId) filter.groupIds = new Types.ObjectId(groupId);
    if (search?.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
      ];
    }
    const docs = await this.contacts
      .find(filter)
      .sort({ name: 1 })
      .limit(200)
      .lean();
    return { items: docs.map((d) => this.toContact(d)) };
  }

  /** Look up specific contacts by id, scoped to org — used by Sessions to resolve participants. */
  async findByIds(orgId: string, ids: string[]): Promise<ContactDto[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!objectIds.length) return [];
    const docs = await this.contacts
      .find({ orgId: new Types.ObjectId(orgId), _id: { $in: objectIds } })
      .lean();
    return docs.map((d) => this.toContact(d));
  }

  async listGroups(orgId: string) {
    const docs = await this.groups
      .find({ orgId: new Types.ObjectId(orgId) })
      .sort({ name: 1 })
      .lean();
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
      created.push(
        this.toContact(doc.toObject() as unknown as Record<string, unknown>),
      );
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

  private toContact(d: Record<string, unknown>): ContactDto {
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      name: String(d.name),
      email: String(d.email),
      department: (d.department as string | null) ?? null,
      groupIds: Array.isArray(d.groupIds) ? d.groupIds.map(String) : [],
      contactType: (d.contactType as ContactDto['contactType']) ?? 'employee',
      userId: d.userId ? String(d.userId) : null,
      createdAt:
        d.createdAt instanceof Date
          ? d.createdAt.toISOString()
          : new Date().toISOString(),
    };
  }

  private toGroup(d: Record<string, unknown>): GroupDto {
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      name: String(d.name),
      memberCount: Number(d.memberCount ?? 0),
      createdAt:
        d.createdAt instanceof Date
          ? d.createdAt.toISOString()
          : new Date().toISOString(),
    };
  }
}
