import { DEFAULT_CONSULT_ROLES, isSeatedProvider } from '../../../shared/constants';
import type { SeatProvider } from '../../../shared/types';
import { SKIP_RESPONSE } from '../state';
import type { NodeId, PromptArg, TextCondition, WorkflowGraph } from './types';

const ERROR_RESPONSE_PATTERN = '^\\[Error:\\s*[\\s\\S]*?\\]$';

function notReady(node: NodeId): TextCondition {
  return {
    type: 'any',
    conditions: [
      { type: 'regex', ref: { kind: 'output', node }, pattern: ERROR_RESPONSE_PATTERN },
      { type: 'equals', left: { kind: 'output', node }, right: { kind: 'literal', text: SKIP_RESPONSE } },
    ],
  };
}

const seatDefault = (provider: SeatProvider) => (isSeatedProvider(provider) ? provider : undefined);

const ANSWER_SEATS = ['first', 'second', 'third'] as const;

// Answer text and provider name per seat, in seat order. An unused seat has an empty name.
const ANSWER_ARGS: PromptArg[] = ANSWER_SEATS.flatMap((seat): PromptArg[] => [
  { kind: 'output', node: seat },
  { kind: 'providerName', provider: { type: 'role', role: seat } },
]);

const INITIAL_STATUS_ARGS: PromptArg[] = ANSWER_SEATS.map((seat): PromptArg => ({
  kind: 'providerName',
  provider: { type: 'role', role: seat },
}));

export const consultGraph: WorkflowGraph = {
  schemaVersion: 1,
  id: 'consult',
  version: 7,
  mode: 'consult',
  start: 'first',
  roles: {
    first: { defaultProvider: DEFAULT_CONSULT_ROLES.first, uiLabel: 'First' },
    second: { defaultProvider: DEFAULT_CONSULT_ROLES.second, uiLabel: 'Second' },
    third: { defaultProvider: seatDefault(DEFAULT_CONSULT_ROLES.third), uiLabel: 'Third', optional: true },
    reviewer: { defaultProvider: DEFAULT_CONSULT_ROLES.reviewer, uiLabel: 'Reviewer' },
    // Optional: without a summary the run ends at the review, which already gives its own answer.
    summary: { defaultProvider: seatDefault(DEFAULT_CONSULT_ROLES.summary), uiLabel: 'Summary', optional: true },
  },
  preflight: {
    kind: 'serial',
    requiredRoles: ['first', 'second', 'third', 'reviewer', 'summary'],
    aliasRules: [{ roles: ['first', 'second', 'third'], unique: true, reason: 'parallel' }],
  },
  nodes: {
    first: {
      kind: 'step',
      provider: { type: 'role', role: 'first' },
      role: 'first',
      label: { builder: 'label.consult.first' },
      status: { builder: 'status.consult.initial', args: INITIAL_STATUS_ARGS },
      prompt: { builder: 'consult.first', args: [{ kind: 'input', name: 'question' }] },
      output: 'firstResponse',
      policy: 'serialRunStep',
      parallelGroup: 'initial',
    },
    second: {
      kind: 'step',
      provider: { type: 'role', role: 'second' },
      role: 'second',
      label: { builder: 'label.consult.second' },
      status: { builder: 'status.consult.initial', args: INITIAL_STATUS_ARGS },
      prompt: { builder: 'consult.second', args: [{ kind: 'input', name: 'question' }] },
      output: 'secondResponse',
      policy: 'serialRunStep',
      parallelGroup: 'initial',
    },
    third: {
      kind: 'step',
      provider: { type: 'role', role: 'third' },
      role: 'third',
      label: { builder: 'label.consult.third' },
      status: { builder: 'status.consult.initial', args: INITIAL_STATUS_ARGS },
      prompt: { builder: 'consult.third', args: [{ kind: 'input', name: 'question' }] },
      output: 'thirdResponse',
      policy: 'serialRunStep',
      parallelGroup: 'initial',
    },
    reviewer: {
      kind: 'step',
      provider: { type: 'role', role: 'reviewer' },
      role: 'reviewer',
      label: { builder: 'label.consult.reviewer' },
      status: { builder: 'status.consult.reviewer' },
      prompt: { builder: 'consult.reviewer', args: [{ kind: 'input', name: 'question' }, ...ANSWER_ARGS] },
      output: 'reviewerResponse',
      policy: 'serialRunStep',
    },
    summary: {
      kind: 'step',
      provider: { type: 'role', role: 'summary' },
      role: 'summary',
      label: { builder: 'label.consult.summary' },
      status: { builder: 'status.consult.summary' },
      prompt: {
        builder: 'consult.summary',
        args: [{ kind: 'input', name: 'question' }, ...ANSWER_ARGS, { kind: 'output', node: 'reviewer' }],
      },
      output: 'summaryResponse',
      policy: 'serialRunStep',
    },
  },
  edges: [
    {
      from: ['first', 'second', 'third'],
      to: 'reviewer',
      when: {
        type: 'not',
        condition: { type: 'all', conditions: [notReady('first'), notReady('second'), notReady('third')] },
      },
    },
    { from: 'reviewer', to: 'summary' },
  ],
  onComplete: { status: '' },
};
