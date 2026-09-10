import { JOB_STATES } from '../../../shared/api/v1/jobs.ts';
import type { JobState } from '../../../shared/api/v1/jobs.ts';
import type { JobsFilterValues } from './JobsFilters.tsx';

// Canonical committed filter keys. The wire/URL layer uses `id`; the
// human-facing alias `jobid` (old UI) is accepted while typing.
const CANONICAL_KEYS = [
  'id',
  'partition',
  'name',
  'user',
  'account',
  'state',
  'stateReason',
] as const;

type CanonicalKey = (typeof CANONICAL_KEYS)[number];

const KEY_ALIASES: Record<string, CanonicalKey> = {
  id: 'id',
  jobid: 'id',
  partition: 'partition',
  name: 'name',
  user: 'user',
  account: 'account',
  state: 'state',
  statereason: 'stateReason',
};

// Static suggestion source for state reasons. Ported from the legacy
// `constants.js` JOB_STATE_REASONS list; the full pending-reason endpoint
// is future work, so no new API is introduced for this.
const STATE_REASON_SUGGESTIONS = [
  'AssocGrp*',
  'AssocMax*',
  'BeginTime',
  'Dependency',
  'Max*PerAccount',
  'Priority',
  'QOSGrp*',
  'QOSMax*',
  'Resources',
];

// Human-facing key completions shown for bare words. `jobid:` /
// `statereason:` spellings match the old UI; both parse to `id` /
// `stateReason`.
const KEY_SUGGESTIONS = [
  'jobid:',
  'partition:',
  'name:',
  'user:',
  'account:',
  'state:',
  'statereason:',
];

const QUICK_FILTER_PATTERN = /\b(id|jobid|partition|name|user|account|state|statereason)\s*:\s*\S+/i;

function isCompoundFilterText(text: string): boolean {
  return QUICK_FILTER_PATTERN.test(text);
}

function stripSurroundingQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// Quote-aware split on spaces. Ported from public/js/filters.js
// parseQuickFilters so `name:"my job" user:alice` stays two tokens.
function splitFilterTokens(filterString: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < filterString.length; index++) {
    const char = filterString[index];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ' ' && !inQuotes) {
      if (current.trim() !== '') {
        pairs.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') {
    pairs.push(current.trim());
  }
  return pairs;
}

// Case-insensitive match against the shared v1 state vocabulary.
// Returns the canonical uppercase form, or null when the value is not a
// known state. Callers must treat null as "hint, commit nothing" — never
// cast arbitrary input into JobState, or the strict v1 API answers 400.
function parseStateValue(value: string): JobState | null {
  const upper = value.toUpperCase();
  if ((JOB_STATES as readonly string[]).includes(upper)) {
    return upper as JobState;
  }
  return null;
}

function invalidStateMessage(value: string): string {
  return `Invalid State "${value}". Valid states: ${JOB_STATES.join(', ')}.`;
}

interface ParsedFilterInput {
  values: Partial<JobsFilterValues>;
  validCount: number;
  hasColon: boolean;
  errors: string[];
}

function parseFilterInput(text: string): ParsedFilterInput {
  const values: Partial<JobsFilterValues> = {};
  const errors: string[] = [];
  const hasColon = text.includes(':');
  for (const token of splitFilterTokens(text)) {
    const colonIndex = token.indexOf(':');
    if (colonIndex <= 0 || colonIndex >= token.length - 1) continue;
    const rawKey = token.substring(0, colonIndex).trim().toLowerCase();
    const canonical = KEY_ALIASES[rawKey];
    if (!canonical) continue;
    const value = stripSurroundingQuotes(token.substring(colonIndex + 1).trim());
    if (!value) continue;
    if (canonical === 'state') {
      const state = parseStateValue(value);
      if (state === null) {
        errors.push(invalidStateMessage(value));
        continue;
      }
      values.state = state;
    } else {
      values[canonical] = value;
    }
  }
  return { values, validCount: Object.keys(values).length, hasColon, errors };
}

interface WordContext {
  word: string;
  start: number;
}

function getWordAtCursor(text: string, cursorPos: number): WordContext {
  const safeCursor = Math.max(0, Math.min(cursorPos, text.length));
  const textBeforeCursor = text.substring(0, safeCursor);
  const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
  const start = lastSpaceIndex + 1;
  return { word: text.substring(start, safeCursor), start };
}

interface FilterSuggestion {
  id: string;
  name: string;
  // Text prepended to the value when inserted (`partition:` or `` for
  // bare selector-mode values).
  prefix: string;
  kind: 'key' | 'value';
}

function toValueSuggestion(id: string, prefix: string): FilterSuggestion {
  return { id, name: id, prefix, kind: 'value' };
}

// Suggestion sources mirror public/js/autocomplete.js: live partitions,
// shared JOB_STATES vocabulary, and the static state-reason list. Free-text
// keys (id/name/user/account) offer no value suggestions.
function getSuggestionsForPrefixedWord(word: string): FilterSuggestion[] | null {
  const lower = word.toLowerCase();
  if (lower.startsWith('partition:')) {
    return null; // needs live partitions; resolved by caller
  }
  if (lower.startsWith('state:')) {
    const needle = word.substring(6).toLowerCase();
    return (JOB_STATES as readonly string[])
      .filter((state) => state.toLowerCase().includes(needle))
      .map((state) => toValueSuggestion(state, 'state:'));
  }
  if (lower.startsWith('statereason:')) {
    const needle = word.substring('statereason:'.length).toLowerCase();
    return STATE_REASON_SUGGESTIONS.filter((reason) =>
      reason.toLowerCase().includes(needle)
    ).map((reason) => toValueSuggestion(reason, 'statereason:'));
  }
  return null;
}

interface SuggestionContext {
  word: string;
  selectedField: CanonicalKey;
  partitions: string[];
}

function getSuggestions({ word, selectedField, partitions }: SuggestionContext): FilterSuggestion[] {
  // Live partitions resolve here; other prefixed states resolve below.
  if (word.toLowerCase().startsWith('partition:')) {
    const needle = word.substring('partition:'.length).toLowerCase();
    return partitions
      .filter((partition) => partition.toLowerCase().includes(needle))
      .map((partition) => toValueSuggestion(partition, 'partition:'));
  }
  const prefixed = getSuggestionsForPrefixedWord(word);
  if (prefixed !== null) {
    return prefixed;
  }

  if (word.includes(':')) {
    return [];
  }

  const needle = word.toLowerCase();
  const keys: FilterSuggestion[] = KEY_SUGGESTIONS.filter((key) =>
    key.toLowerCase().startsWith(needle)
  ).map((key) => ({ id: key, name: key, prefix: '', kind: 'key' as const }));

  // Novice mode: when no `key:` prefix is typed, also suggest values for
  // the selected field (old fallback on `select#filter-field`). Values rank
  // first so the selected field's useful completions are not crowded out by
  // the generic key suggestions; keys still follow for compound syntax.
  let values: FilterSuggestion[] = [];
  if (selectedField === 'partition') {
    values = partitions
      .filter((partition) => partition.toLowerCase().includes(needle))
      .map((partition) => toValueSuggestion(partition, ''));
  } else if (selectedField === 'state') {
    values = (JOB_STATES as readonly string[])
      .filter((state) => state.toLowerCase().includes(needle))
      .map((state) => toValueSuggestion(state, ''));
  } else if (selectedField === 'stateReason') {
    values = STATE_REASON_SUGGESTIONS.filter((reason) =>
      reason.toLowerCase().includes(needle)
    ).map((reason) => toValueSuggestion(reason, ''));
  }
  return [...values, ...keys].slice(0, 10);
}

// Pure insertion: replaces the word under the cursor with the suggestion.
// Only the draft changes; nothing is committed until Enter/Apply.
function insertSuggestion(
  draftText: string,
  wordStart: number,
  cursorPos: number,
  suggestion: FilterSuggestion
): { text: string; cursorPos: number } {
  const safeCursor = Math.max(0, Math.min(cursorPos, draftText.length));
  const safeStart = Math.max(0, Math.min(wordStart, safeCursor));
  const nextSpace = draftText.indexOf(' ', safeCursor);
  const wordEnd = nextSpace === -1 ? draftText.length : nextSpace;
  const replacement =
    suggestion.kind === 'key' ? suggestion.id : `${suggestion.prefix}${suggestion.id}`;
  const text = draftText.substring(0, safeStart) + replacement + draftText.substring(wordEnd);
  return { text, cursorPos: safeStart + replacement.length };
}

export {
  CANONICAL_KEYS,
  KEY_SUGGESTIONS,
  STATE_REASON_SUGGESTIONS,
  getSuggestions,
  getWordAtCursor,
  insertSuggestion,
  invalidStateMessage,
  isCompoundFilterText,
  parseFilterInput,
  parseStateValue,
  splitFilterTokens,
};
export type { CanonicalKey, FilterSuggestion, ParsedFilterInput };
