import { useEffect, useRef, useState } from 'react';
import { JOB_STATES } from '../../../shared/api/v1/jobs.ts';
import type { JobState } from '../../../shared/api/v1/jobs.ts';

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

function JobsFilters({
  filters,
  partitions,
  partitionsUnavailable,
  partitionsStale,
  onPartitionsRetry,
  onFiltersChange,
}: JobsFiltersProps) {
  const [draft, setDraft] = useState(filters);
  const lastCommitted = useRef(filters);

  useEffect(() => {
    setDraft(filters);
    lastCommitted.current = filters;
  }, [filters]);

  useEffect(() => {
    if (filtersEqual(draft, lastCommitted.current)) return;
    const timer = setTimeout(() => {
      lastCommitted.current = draft;
      onFiltersChange(draft);
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, onFiltersChange]);

  function commitImmediately(next: JobsFilterValues) {
    setDraft(next);
    lastCommitted.current = next;
    onFiltersChange(next);
  }

  const activeEntries = (Object.entries(draft) as Array<[keyof JobsFilterValues, string]>).filter(
    ([, value]) => value !== '',
  );

  const inputClass = 'w-full rounded border p-2 text-sm';

  return (
    <div className="mb-4">
      <form
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <input
          aria-label="Job ID"
          placeholder="Job ID"
          className={inputClass}
          value={draft.id}
          onChange={(event) => setDraft({ ...draft, id: event.target.value })}
        />
        <input
          aria-label="Name"
          placeholder="Name"
          className={inputClass}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <input
          aria-label="User"
          placeholder="User"
          className={inputClass}
          value={draft.user}
          onChange={(event) => setDraft({ ...draft, user: event.target.value })}
        />
        <input
          aria-label="Account"
          placeholder="Account"
          className={inputClass}
          value={draft.account}
          onChange={(event) => setDraft({ ...draft, account: event.target.value })}
        />
        <select
          aria-label="Partition"
          className={inputClass}
          value={draft.partition}
          disabled={partitionsUnavailable}
          onChange={(event) => commitImmediately({ ...draft, partition: event.target.value })}
        >
          <option value="">All partitions</option>
          {partitions.map((partition) => (
            <option key={partition} value={partition}>
              {partition}
            </option>
          ))}
        </select>
        <select
          aria-label="State"
          className={inputClass}
          value={draft.state}
          onChange={(event) =>
            commitImmediately({ ...draft, state: event.target.value as JobsFilterValues['state'] })
          }
        >
          <option value="">All states</option>
          {JOB_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        <input
          aria-label="State reason"
          placeholder="State reason"
          className={`${inputClass} col-span-2 md:col-span-2`}
          value={draft.stateReason}
          onChange={(event) => setDraft({ ...draft, stateReason: event.target.value })}
        />
        {/* TODO: Add state-reason suggestions when the new pending-reason flow is wired in. */}
      </form>
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
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Active filters">
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
                onClick={() => commitImmediately({ ...draft, [key]: '' })}
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
