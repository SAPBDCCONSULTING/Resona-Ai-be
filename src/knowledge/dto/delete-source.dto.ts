import { Equals } from 'class-validator';

/** Deletion is irreversible, so the caller must affirmatively pass confirm:true — a bare DELETE with no body can never trigger it. */
export class DeleteKnowledgeSourceDto {
  @Equals(true)
  confirm!: true;
}
