import { IsString, IsOptional, Length, MaxLength } from 'class-validator';

// Both fields optional: since Phase 1 the document's text is owned by the
// CRDT and written by CodeSyncService, so the client only ever sends
// `language` here. `content` stays accepted for the one case the CRDT
// can't cover -- a client with no socket connection -- and because
// rejecting it outright would break any older tab still open.
export class SaveCodeDocumentDto {
  @IsString()
  @IsOptional()
  @MaxLength(500_000)
  content?: string;

  @IsString()
  @IsOptional()
  @Length(1, 30)
  language?: string;
}
