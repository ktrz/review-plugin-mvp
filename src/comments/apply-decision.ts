import type { FindingItem, HandoverDocument } from '../schema';
import {
  markResolved,
  markCustom,
  markSkipped,
  markDeferred,
  markUnresolved,
} from '../schema';

export type ThreadDecision = 'post' | 'dismiss' | 'discuss' | 'unresolve';

export type FinalizeChatDecision = { kind: 'finalizeChat'; resolution: string };

export type DecisionInput = ThreadDecision | FinalizeChatDecision;

export type ApplyDecisionErrorKind = 'unknown-id' | 'unknown-decision';

export class ApplyDecisionError extends Error {
  readonly kind: ApplyDecisionErrorKind;
  readonly findingId?: string;
  readonly decision?: string;

  constructor(args:
    | { kind: 'unknown-id'; findingId: string }
    | { kind: 'unknown-decision'; decision: string }) {
    const message =
      args.kind === 'unknown-id'
        ? `Unknown finding id: ${args.findingId}`
        : `Unknown decision: ${args.decision}`;
    super(message);
    this.name = 'ApplyDecisionError';
    this.kind = args.kind;
    if (args.kind === 'unknown-id') {
      this.findingId = args.findingId;
    } else {
      this.decision = args.decision;
    }
  }
}

const POST_RESOLUTION_PLACEHOLDER = '(posted via plugin)';

function mutateForStringDecision(
  item: FindingItem,
  decision: ThreadDecision,
): FindingItem {
  switch (decision) {
    case 'post':
      return markResolved(item, POST_RESOLUTION_PLACEHOLDER);
    case 'dismiss':
      return markSkipped(item);
    case 'discuss':
      return markDeferred(item);
    case 'unresolve':
      return markUnresolved(item);
    default: {
      const exhaustive: never = decision;
      throw new ApplyDecisionError({ kind: 'unknown-decision', decision: String(exhaustive) });
    }
  }
}

function isKnownStringDecision(value: string): value is ThreadDecision {
  return value === 'post' || value === 'dismiss' || value === 'discuss' || value === 'unresolve';
}

export function applyDecision(
  doc: HandoverDocument,
  findingId: string,
  decision: DecisionInput,
): HandoverDocument {
  const index = doc.items.findIndex((it) => it.id === findingId);

  if (typeof decision === 'string') {
    if (!isKnownStringDecision(decision)) {
      throw new ApplyDecisionError({
        kind: 'unknown-decision',
        decision: String(decision),
      });
    }
    if (index === -1) {
      throw new ApplyDecisionError({ kind: 'unknown-id', findingId });
    }
    const current = doc.items[index];
    const next = mutateForStringDecision(current, decision);
    const nextItems = doc.items.slice();
    nextItems[index] = next;
    return { ...doc, items: nextItems };
  }

  if (decision.kind !== 'finalizeChat') {
    throw new ApplyDecisionError({
      kind: 'unknown-decision',
      decision: String((decision as { kind?: unknown }).kind),
    });
  }

  if (index === -1) {
    throw new ApplyDecisionError({ kind: 'unknown-id', findingId });
  }

  const current = doc.items[index];
  const next = markCustom(current, decision.resolution);
  const nextItems = doc.items.slice();
  nextItems[index] = next;
  return { ...doc, items: nextItems };
}
