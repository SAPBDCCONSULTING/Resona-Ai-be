import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
