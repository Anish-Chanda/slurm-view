// Single-reservation lookup. Reservation output has no stable JSON
// contract across parser generations; all fields stay nullable.
import { runCommand } from './command-runner.js';
import { CommandError } from './command-runner.js';
import { UpstreamInvalidError } from './errors.js';
import type { SlurmContext, SlurmRunFn } from './context.js';

const RESERVATION_COMMAND_TIMEOUT_MS = 15_000;
const RESERVATION_COMMAND_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

const RESERVATION_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

interface ParsedReservation {
  // Identity from Slurm, or null when the record carries none.
  readonly name: string | null;
  readonly state: string | null;
  readonly startTime: Date | null;
  readonly endTime: Date | null;
}

function cleanText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed !== '(null)' ? trimmed : null;
}

function parseSlurmDateTime(input: string | null): Date | null {
  if (input === null) {
    return null;
  }
  // Slurm emits "2026-05-01T10:00:00" or "2026-05-01 10:00:00".
  const normalized = input.includes('T') ? input : input.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface ReservationDetail {
  readonly name: string;
  readonly state: string | null;
  readonly startTime: Date | null;
  readonly endTime: Date | null;
}

function parseReservationText(stdout: string): ParsedReservation | null {
  // Classic "ReservationName=X StartTime=... EndTime=... State=..." text,
  // possibly across multiple lines; take the first record.
  const text = stdout.trim();
  if (text.length === 0) {
    return null;
  }
  const firstRecord = text.split(/\n\s*\n/)[0] ?? text;
  const flat = firstRecord.replace(/\n/g, ' ');
  const field = (key: string): string | null => {
    const match = flat.match(new RegExp(`${key}=([^\\s]+(?: [^\\s=]+)?)`));
    if (!match) {
      return null;
    }
    const candidate = (match[1] ?? '').trim();
    if (key === 'State' || key === 'ReservationName') {
      return candidate.split(/\s/)[0] ?? null;
    }
    const twoTokens = candidate.split(/\s+/).slice(0, 2).join(' ');
    return parseSlurmDateTime(twoTokens) !== null ? twoTokens : candidate.split(/\s/)[0] ?? null;
  };
  const name = cleanText(field('ReservationName'));
  return {
    name,
    state: cleanText(field('State')),
    startTime: parseSlurmDateTime(cleanText(field('StartTime'))),
    endTime: parseSlurmDateTime(cleanText(field('EndTime'))),
  };
}

function parseReservationJson(stdout: string): ParsedReservation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const list = Array.isArray(record['reservations'])
    ? (record['reservations'] as Array<Record<string, unknown>>)
    : Array.isArray(record['reservation'])
      ? (record['reservation'] as Array<Record<string, unknown>>)
      : null;
  const entry = list?.[0] ?? record;
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      const value = (entry as Record<string, unknown>)[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return null;
  };
  const nameRaw = pick('name', 'reservation_name', 'ReservationName');
  const stateRaw = pick('state', 'State');
  const startRaw = pick('start_time', 'startTime', 'StartTime');
  const endRaw = pick('end_time', 'endTime', 'EndTime');
  const toText = (value: unknown): string | null => {
    if (typeof value === 'string') {
      return cleanText(value);
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return new Date(Math.round(value * 1000)).toISOString();
    }
    if (typeof value === 'object' && value !== null) {
      const inner = (value as { number?: unknown }).number;
      if (typeof inner === 'number' && Number.isFinite(inner) && inner > 0) {
        return new Date(Math.round(inner * 1000)).toISOString();
      }
    }
    return null;
  };
  const name = typeof nameRaw === 'string' ? cleanText(nameRaw) : null;
  const state = typeof stateRaw === 'string' ? cleanText(stateRaw) : null;
  const startText = toText(startRaw);
  const endText = toText(endRaw);
  if (name === null && state === null && startText === null && endText === null) {
    return null;
  }
  return {
    name,
    state,
    startTime: startText === null ? null : parseSlurmDateTime(startText),
    endTime: endText === null ? null : parseSlurmDateTime(endText),
  };
}

async function fetchReservationDetail(
  context: SlurmContext,
  name: string,
  options: { signal?: AbortSignal } = {}
): Promise<ReservationDetail | null> {
  if (!RESERVATION_NAME_PATTERN.test(name)) {
    return null;
  }
  const run: SlurmRunFn = context.run ?? runCommand;
  // Fall back to text only when this Slurm version does not support JSON
  // output. A usable JSON command with an unusable payload is an upstream
  // error; aborts, timeouts, and controller failures propagate.
  try {
    const json = await run('scontrol', [`--json=${context.parser}`, 'show', 'reservation', name], {
      timeoutMs: RESERVATION_COMMAND_TIMEOUT_MS,
      maxBufferBytes: RESERVATION_COMMAND_MAX_BUFFER_BYTES,
      signal: options.signal,
    });
    const fromJson = parseReservationJson(json.stdout);
    if (fromJson === null) {
      throw new UpstreamInvalidError(
        `scontrol returned unusable reservation JSON for "${name}"`
      );
    }
    return requireIdentity(fromJson, name);
  } catch (error) {
    if (error instanceof UpstreamInvalidError) {
      throw error;
    }
    if (error instanceof CommandError) {
      const text = `${error.stderrSnippet ?? ''}\n${error.message ?? ''}`;
      const unsupportedJson =
        error.kind === 'non-zero-exit' && /invalid option|unrecognized option|unknown option|json.*not supported|not supported.*json/i.test(text);
      if (!unsupportedJson) {
        throw error;
      }
      // Unsupported JSON mode: continue to the text command below.
    } else {
      throw error;
    }
  }
  const { stdout } = await run('scontrol', ['show', 'reservation', name], {
    timeoutMs: RESERVATION_COMMAND_TIMEOUT_MS,
    maxBufferBytes: RESERVATION_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  const fromText = parseReservationText(stdout);
  if (fromText === null) {
    return null;
  }
  return requireIdentity(fromText, name);
}

// Require the returned reservation name to match the requested one.
function requireIdentity(record: ParsedReservation, name: string): ReservationDetail {
  if (record.name === null) {
    throw new UpstreamInvalidError(
      `scontrol returned a reservation record without identity (requested "${name}")`
    );
  }
  if (record.name.toLowerCase() !== name.toLowerCase()) {
    throw new UpstreamInvalidError(
      `scontrol returned a different reservation (requested "${name}")`
    );
  }
  return { name: record.name, state: record.state, startTime: record.startTime, endTime: record.endTime };
}

export {
  RESERVATION_COMMAND_MAX_BUFFER_BYTES,
  RESERVATION_COMMAND_TIMEOUT_MS,
  fetchReservationDetail,
  parseReservationJson,
  parseReservationText,
};
export type { ReservationDetail };
