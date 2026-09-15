import { useEffect, useId, useRef, useState } from 'react';
import type { JobState } from '../../../shared/api/v1/jobs.ts';
import {
  getSuggestions,
  getWordAtCursor,
  insertSuggestion,
  invalidStateMessage,
  isCompoundFilterText,
  parseFilterInput,
  parseStateValue,
} from './filter-syntax.ts';
import type { CanonicalKey, FilterSuggestion } from './filter-syntax.ts';

interface JobsFilterValues {
  id: string;
  partition: string;
  name: string;
  user: string;
  account: string;
  state: '' | JobState;
  stateReason: string;
}

const EMPTY_FILTERS: JobsFilterValues = {
  id: '',
  partition: '',
  name: '',
  user: '',
  account: '',
  state: '',
  stateReason: '',
};

const FILTER_LABELS: Record<keyof JobsFilterValues, string> = {
  id: 'Job ID',
  partition: 'Partition',
  name: 'Name',
  user: 'User',
  account: 'Account',
  state: 'State',
  stateReason: 'State reason',
};

const FIELD_OPTIONS: Array<{ value: CanonicalKey; label: string }> = [
  { value: 'id', label: 'Job ID' },
  { value: 'partition', label: 'Partition' },
  { value: 'name', label: 'Name' },
  { value: 'user', label: 'User' },
  { value: 'account', label: 'Account' },
  { value: 'state', label: 'State' },
  { value: 'stateReason', label: 'State Reason' },
];

function filtersEqual(left: JobsFilterValues, right: JobsFilterValues): boolean {
  return (
    left.id === right.id &&
    left.partition === right.partition &&
    left.name === right.name &&
    left.user === right.user &&
    left.account === right.account &&
    left.state === right.state &&
    left.stateReason === right.stateReason
  );
}

interface JobsFiltersProps {
  filters: JobsFilterValues;
  partitions: string[];
  partitionsUnavailable: boolean;
  partitionsStale: boolean;
  onPartitionsRetry: () => void;
  onFiltersChange: (filters: JobsFilterValues) => void;
}

// Compact field selector + single intelligent input (old UI model).
// Typing only edits the draft; Enter/Apply commits. Suggestions never
// commit on their own. Server requests fire on commit, never per keystroke.
function JobsFilters({
  filters,
  partitions,
  partitionsUnavailable,
  partitionsStale,
  onPartitionsRetry,
  onFiltersChange,
}: JobsFiltersProps) {
  // Job ID first, matching the old UI's initial field.
  const [field, setField] = useState<CanonicalKey>('id');
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<FilterSuggestion[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  useEffect(() => {
    return () => {
      if (blurTimer.current !== null) clearTimeout(blurTimer.current);
    };
  }, []);

  function refreshSuggestions(text: string, cursorPos: number, selectedField: CanonicalKey) {
    const { word } = getWordAtCursor(text, cursorPos);
    const matches = getSuggestions({ word, selectedField, partitions });
    setSuggestions(matches);
    setDropdownOpen(matches.length > 0);
    setActiveIndex(-1);
  }

  function handleDraftChange(text: string, selectedField: CanonicalKey) {
    setDraft(text);
    setHint(null);
    const cursor = inputRef.current?.selectionStart ?? text.length;
    refreshSuggestions(text, cursor, selectedField);
  }

  function acceptSuggestion(suggestion: FilterSuggestion) {
    const cursor = inputRef.current?.selectionStart ?? draft.length;
    const { start } = getWordAtCursor(draft, cursor);
    const { text, cursorPos } = insertSuggestion(draft, start, cursor, suggestion);
    setDraft(text);
    setHint(null);
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
    // Return focus and restore the cursor after the inserted value so a
    // compound query can keep being typed without committing.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursorPos, cursorPos);
    });
  }

  function commit(text: string, selectedField: CanonicalKey) {
    const trimmed = text.trim();
    if (trimmed === '') {
      setSuggestions([]);
      setDropdownOpen(false);
      setHint(null);
      return;
    }
    const parsed = parseFilterInput(trimmed);
    if (parsed.errors.length > 0) {
      // e.g. state:bananas — hint and commit nothing rather than letting
      // the strict v1 API answer 400.
      setHint(parsed.errors.join(' '));
      setSuggestions([]);
      setDropdownOpen(false);
      return;
    }
    if (parsed.validCount > 0) {
      onFiltersChange({ ...filters, ...parsed.values });
      setDraft('');
      setSuggestions([]);
      setDropdownOpen(false);
      setActiveIndex(-1);
      setHint(null);
      return;
    }
    if (parsed.hasColon) {
      // Colon present but no valid key:value pair (old "Invalid format!"
      // feedback, surfaced accessibly instead of via placeholder).
      setHint('Invalid format! Use: key1:value1 key2:value2');
      setSuggestions([]);
      setDropdownOpen(false);
      return;
    }
    if (selectedField === 'state') {
      const state = parseStateValue(trimmed);
      if (state === null) {
        setHint(invalidStateMessage(trimmed));
        setSuggestions([]);
        setDropdownOpen(false);
        return;
      }
      onFiltersChange({ ...filters, state });
      setDraft('');
      setSuggestions([]);
      setDropdownOpen(false);
      setActiveIndex(-1);
      setHint(null);
      return;
    }
    onFiltersChange({ ...filters, [selectedField]: trimmed });
    setDraft('');
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
    setHint(null);
  }

  function removeFilter(key: keyof JobsFilterValues) {
    onFiltersChange({ ...filters, [key]: '' });
  }

  const activeEntries = (Object.entries(filters) as Array<[keyof JobsFilterValues, string]>).filter(
    ([, value]) => value !== '',
  );
  const compound = isCompoundFilterText(draft);

  return (
    <div className="mb-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          commit(draft, field);
        }}
      >
        <select
          aria-label="Filter field"
          className="rounded border p-2 text-sm disabled:opacity-50"
          value={field}
          // In compound mode the draft carries its own keys, so the
          // selector is irrelevant: disable and dim it (old UI behavior).
          disabled={compound}
          onChange={(event) => {
            const next = event.target.value as CanonicalKey;
            setField(next);
            refreshSuggestions(draft, inputRef.current?.selectionStart ?? draft.length, next);
          }}
        >
          {FIELD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            aria-label="Filter value"
            placeholder="Filter value or 'key1:value1 key2:value2' for multiple"
            autoComplete="off"
            role="combobox"
            aria-expanded={dropdownOpen}
            aria-controls={listboxId}
            aria-activedescendant={
              dropdownOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            className="w-full rounded border p-2 text-sm"
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value, field)}
            onClick={(event) =>
              refreshSuggestions(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                field
              )
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && dropdownOpen) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % suggestions.length);
              } else if (event.key === 'ArrowUp' && dropdownOpen) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
              } else if (event.key === 'Enter' && dropdownOpen && activeIndex >= 0) {
                // Accepting a suggestion edits the draft only; a second
                // Enter commits the full query.
                event.preventDefault();
                const suggestion = suggestions[activeIndex];
                if (suggestion) acceptSuggestion(suggestion);
              } else if (event.key === 'Escape' && dropdownOpen) {
                event.preventDefault();
                setSuggestions([]);
                setDropdownOpen(false);
                setActiveIndex(-1);
              }
            }}
            onBlur={() => {
              // Deferred so suggestion clicks (mousedown) win over blur.
              blurTimer.current = setTimeout(() => {
                setSuggestions([]);
                setDropdownOpen(false);
                setActiveIndex(-1);
              }, 120);
            }}
            onFocus={(event) =>
              refreshSuggestions(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                field
              )
            }
          />
          {dropdownOpen ? (
            <div
              id={listboxId}
              role="listbox"
              aria-label="Filter suggestions"
              className="absolute right-0 left-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded border border-gray-300 bg-white shadow-lg"
            >
              {suggestions.map((suggestion, index) => (
                <div
                  key={`${suggestion.kind}-${suggestion.prefix}-${suggestion.id}`}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`cursor-pointer border-b p-2 last:border-b-0 hover:bg-gray-100 ${
                    index === activeIndex ? 'bg-blue-100' : ''
                  }`}
                  onMouseDown={(event) => {
                    // Prevent input blur before the click registers.
                    event.preventDefault();
                    acceptSuggestion(suggestion);
                  }}
                >
                  <span className="font-medium">
                    {suggestion.kind === 'key' ? suggestion.id : suggestion.name}
                  </span>{' '}
                  <span className="ml-1 text-xs text-gray-500">
                    {suggestion.kind === 'key'
                      ? '(filter)'
                      : suggestion.prefix !== ''
                        ? `(${suggestion.prefix}${suggestion.id})`
                        : `(${FILTER_LABELS[field]})`}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          className="rounded bg-blue-500 p-2 text-white transition-colors hover:bg-blue-600"
        >
          {compound ? 'Add Filters' : 'Add Filter'}
        </button>
      </form>
      {hint !== null ? (
        <p className="mt-2 text-sm text-red-600" role="status">
          {hint}
        </p>
      ) : null}
      {partitionsUnavailable ? (
        <p className="mt-2 text-sm text-amber-700" role="status">
          Partition list unavailable.{' '}
          <button type="button" className="font-medium underline" onClick={onPartitionsRetry}>
            Retry
          </button>
        </p>
      ) : partitionsStale ? (
        <p className="mt-2 text-sm text-gray-500" role="status">
          Partition list may be out of date.
        </p>
      ) : null}
      {activeEntries.length > 0 ? (
        <div id="active-filters" className="mt-2 flex flex-wrap gap-2" aria-label="Active filters">
          {activeEntries.map(([key, value]) => (
            <span
              key={key}
              className="flex items-center rounded-full bg-gray-300 px-3 py-1 text-sm text-gray-700"
            >
              {FILTER_LABELS[key]}: {value}
              <button
                type="button"
                aria-label={`Remove ${FILTER_LABELS[key]} filter`}
                data-key={key}
                className="ml-2 font-bold text-red-500"
                onClick={() => removeFilter(key)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export { EMPTY_FILTERS, JobsFilters, filtersEqual };
export type { JobsFilterValues };
