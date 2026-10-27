import { IsIn, IsString, MaxLength } from 'class-validator';
import { WEB_APPROVAL_TYPES } from '../../schemas/knowledge-web-approval.schema';

export class CreateWebApprovalDto {
  @IsIn(WEB_APPROVAL_TYPES)
  type!: 'exact_url' | 'domain';

  /**
   * A full https:// URL. For 'domain' type, only scheme+host+port are
   * compared at match time — any path/query provided here is still
   * validated for shape but not otherwise meaningful; callers should omit
   * the path for clarity. Validated server-side against the same
   * scheme/credential/shape rules used at fetch time (see
   * web-ssrf-guard.util.ts) before the entry is ever stored.
   */
  @IsString()
  @MaxLength(2000)
  value!: string;
}
