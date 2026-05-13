// Types and schemas
export {
  SeveritySchema,
  StatusMarkerSchema,
  LocationSchema,
  SourceSchema,
  ChatMessageSchema,
  FindingItemSchema,
  BranchRefSchema,
  DocumentHeaderSchema,
  HandoverDocumentSchema,
} from './types';

export type {
  Severity,
  StatusMarker,
  Location,
  Source,
  ChatMessage,
  BranchRef,
  FindingItem,
  DocumentHeader,
  HandoverDocument,
} from './types';

// Parser
export { parseDocument, ParseError } from './parse';
export type { ParserState } from './parse';

// Serializer
export { serializeDocument } from './serialize';

// Mutations
export { markResolved, markCustom, markDeferred, markSkipped, markUnresolved, withResolution, appendChat, UnknownIdError } from './mutations';

// Stamper
export { stampMissingIds } from './stamp';
export type { StampDeps } from './stamp';
