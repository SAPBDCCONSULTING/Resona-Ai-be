import { IsMongoId } from 'class-validator';

export class SupersedeKnowledgeSourceDto {
  /** The already-published source that replaces the one being superseded. Validated server-side to belong to this org and be published. */
  @IsMongoId()
  supersededBySourceId!: string;
}
