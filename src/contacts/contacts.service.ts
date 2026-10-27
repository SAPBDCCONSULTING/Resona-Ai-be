import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isTimeZone } from 'class-validator';
import {
  CONTACT_GENDERS,
  CONTACT_GENDER_LABELS,
  CONTACT_LANGUAGES,
  CONTACT_LANGUAGE_LABELS,
  IANA_TIMEZONE_PATTERN,
  isValidDateOfBirth,
  type Contact as ContactDto,
  type ContactGender,
  type ContactLanguage,
  type ContactGroup as GroupDto,
} from '@pulsefeedback/shared';
import {
  Contact,
  ContactDocument,
  ContactGroup,
  ContactGroupDocument,
} from '../schemas/contact.schema';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';

/** Column order of the CSV export; also the order import assumes when a file has no header row. */
const CSV_COLUMNS = [
  'name',
  'email',
  'department',
  'designation',
  'timezone',
  'city',
  'country',
  'gender',
  'dateOfBirth',
  'preferredLanguage',
] as const;
type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Other header spellings accepted on import, written as normalised by csvColumns. */
const CSV_HEADER_ALIASES: Record<string, string> = {
  dob: 'dateofbirth',
  birthdate: 'dateofbirth',
  language: 'preferredlanguage',
};

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
    if (!lines.length) return { imported: 0, incomplete: 0, items: [] as ContactDto[] };

    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('email') || header.includes('name');
    const rows = hasHeader ? lines.slice(1) : lines;
    const columns = this.csvColumns(hasHeader ? this.parseCsvLine(lines[0]) : null);
    const created: ContactDto[] = [];

    for (const row of rows) {
      const parts = this.parseCsvLine(row);
      if (parts.length < 2) continue;
      const cell = (column: CsvColumn): string => parts[columns[column]] ?? '';
      const name = cell('name');
      const email = cell('email');
      const department = cell('department');
      if (!email || !email.includes('@')) continue;

      // Profile fields are only written when the row holds a usable value, so a
      // name,email,department file never wipes details already saved on a contact.
      // Anything missing or invalid stays null and shows as empty in the dashboard.
      const profile: Record<string, string> = {};
      if (cell('designation')) profile.designation = cell('designation');
      if (this.isIanaTimezone(cell('timezone'))) profile.timezone = cell('timezone');
      if (cell('city')) profile.city = cell('city');
      if (cell('country')) profile.country = cell('country');
      const gender = this.parseGender(cell('gender'));
      if (gender) profile.gender = gender;
      if (isValidDateOfBirth(cell('dateOfBirth'))) profile.dateOfBirth = cell('dateOfBirth');
      const language = this.parseLanguage(cell('preferredLanguage'));
      if (language) profile.preferredLanguage = language;

      const doc = await this.contacts.findOneAndUpdate(
        { orgId: new Types.ObjectId(orgId), email: email.toLowerCase() },
        {
          $set: {
            name: name || email.split('@')[0],
            department: department || null,
            contactType: 'employee',
            ...profile,
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

    const incomplete = created.filter(
      (c) => !c.designation || !c.timezone || !c.city || !c.country || !c.gender,
    ).length;
    return { imported: created.length, incomplete, items: created };
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
    const lines = [CSV_COLUMNS.join(',')];
    for (const d of docs) {
      const gender = this.parseGender(String(d.gender ?? ''));
      const language = this.parseLanguage(String(d.preferredLanguage ?? ''));
      lines.push(
        [
          escape(String(d.name ?? '')),
          escape(String(d.email ?? '')),
          escape(String(d.department ?? '')),
          escape(String(d.designation ?? '')),
          escape(String(d.timezone ?? '')),
          escape(String(d.city ?? '')),
          escape(String(d.country ?? '')),
          escape(gender ? CONTACT_GENDER_LABELS[gender] : ''),
          escape(this.dateOfBirthOrNull(d.dateOfBirth) ?? ''),
          escape(language ? CONTACT_LANGUAGE_LABELS[language] : ''),
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
        designation: dto.designation.trim(),
        timezone: dto.timezone.trim(),
        city: dto.city.trim(),
        country: dto.country.trim(),
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ?? null,
        preferredLanguage: dto.preferredLanguage ?? null,
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
    if (dto.designation !== undefined) update.designation = dto.designation.trim();
    if (dto.timezone !== undefined) update.timezone = dto.timezone.trim();
    if (dto.city !== undefined) update.city = dto.city.trim();
    if (dto.country !== undefined) update.country = dto.country.trim();
    if (dto.gender !== undefined) update.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) update.dateOfBirth = dto.dateOfBirth;
    if (dto.preferredLanguage !== undefined) update.preferredLanguage = dto.preferredLanguage;
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

  /**
   * Maps each CSV column to its index in a row. Named header cells win; without one,
   * name/email/department keep their original fixed positions and the profile
   * columns are only read from a header-less file laid out like the export.
   * Header matching ignores case, spaces and underscores ("Date of Birth" = dateOfBirth).
   */
  private csvColumns(header: string[] | null): Record<CsvColumn, number> {
    const named = (header ?? []).map((h) => {
      const key = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      return CSV_HEADER_ALIASES[key] ?? key;
    });
    const columns = {} as Record<CsvColumn, number>;
    CSV_COLUMNS.forEach((column, position) => {
      const found = named.indexOf(column.toLowerCase());
      if (found >= 0) columns[column] = found;
      else columns[column] = header && position > 2 ? -1 : position;
    });
    return columns;
  }

  /** Splits one CSV row, honouring "quoted, cells" and "" escapes as written by exportCsv. */
  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cell.trim());
        cell = '';
      } else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  }

  private isIanaTimezone(value: string): boolean {
    return IANA_TIMEZONE_PATTERN.test(value) && isTimeZone(value);
  }

  /** Accepts a stored value ("non_binary") or its label ("Non-binary"), any case. */
  private parseGender(value: string): ContactGender | null {
    const wanted = value.trim().toLowerCase();
    if (!wanted) return null;
    return (
      CONTACT_GENDERS.find(
        (g) => g === wanted || CONTACT_GENDER_LABELS[g].toLowerCase() === wanted,
      ) ?? null
    );
  }

  /** Accepts a stored code ("hi") or its label ("Hindi"), any case. */
  private parseLanguage(value: string): ContactLanguage | null {
    const wanted = value.trim().toLowerCase();
    if (!wanted) return null;
    return (
      CONTACT_LANGUAGES.find(
        (l) => l === wanted || CONTACT_LANGUAGE_LABELS[l].toLowerCase() === wanted,
      ) ?? null
    );
  }

  private dateOfBirthOrNull(value: unknown): string | null {
    return typeof value === 'string' && isValidDateOfBirth(value) ? value : null;
  }

  /** Blank or missing text becomes null so the dashboard can show it as empty. */
  private textOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
      designation: this.textOrNull(d.designation),
      timezone: this.textOrNull(d.timezone),
      city: this.textOrNull(d.city),
      country: this.textOrNull(d.country),
      gender: this.parseGender(typeof d.gender === 'string' ? d.gender : ''),
      dateOfBirth: this.dateOfBirthOrNull(d.dateOfBirth),
      preferredLanguage: this.parseLanguage(
        typeof d.preferredLanguage === 'string' ? d.preferredLanguage : '',
      ),
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
