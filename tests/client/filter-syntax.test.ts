import {
  getSuggestions,
  getWordAtCursor,
  insertSuggestion,
  isCompoundFilterText,
  parseFilterInput,
  parseStateValue,
  splitFilterTokens,
} from '../../src/client/features/jobs/filter-syntax';

describe('splitFilterTokens', () => {
  test('splits on spaces but respects quotes', () => {
    expect(splitFilterTokens('user:alice partition:nova')).toEqual(['user:alice', 'partition:nova']);
    expect(splitFilterTokens('name:"my job" user:alice')).toEqual(['name:"my job"', 'user:alice']);
    expect(splitFilterTokens("name:'my job'  user:alice ")).toEqual(["name:'my job'", 'user:alice']);
  });
});

describe('parseStateValue', () => {
  test('matches case-insensitively and normalizes to canonical form', () => {
    expect(parseStateValue('running')).toBe('RUNNING');
    expect(parseStateValue('Running')).toBe('RUNNING');
    expect(parseStateValue('PENDING')).toBe('PENDING');
  });

  test('rejects unknown values with null', () => {
    expect(parseStateValue('bananas')).toBeNull();
    expect(parseStateValue('')).toBeNull();
  });
});

describe('parseFilterInput', () => {
  test('parses compound key:value pairs', () => {
    const parsed = parseFilterInput('user:alice partition:nova state:RUNNING');
    expect(parsed.validCount).toBe(3);
    expect(parsed.values).toEqual({ user: 'alice', partition: 'nova', state: 'RUNNING' });
  });

  test('keys are case-insensitive and jobid/statereason are aliases', () => {
    const parsed = parseFilterInput('User:alice JOBID:42 StateReason:Priority');
    expect(parsed.values).toEqual({ user: 'alice', id: '42', stateReason: 'Priority' });
  });

  test('state values normalize to the shared uppercase vocabulary', () => {
    expect(parseFilterInput('state:running').values.state).toBe('RUNNING');
    expect(parseFilterInput('state:RUNNING').values.state).toBe('RUNNING');
  });

  test('quoted values keep their spaces', () => {
    expect(parseFilterInput('name:"my job"').values.name).toBe('my job');
  });

  test('unknown keys and empty values are ignored', () => {
    const parsed = parseFilterInput('bogus:x user: user:bob');
    expect(parsed.values).toEqual({ user: 'bob' });
    expect(parsed.validCount).toBe(1);
  });

  test('last duplicate wins (AND semantics downstream)', () => {
    expect(parseFilterInput('user:alice user:bob').values.user).toBe('bob');
  });

  test('invalid state values report errors and commit nothing', () => {
    const parsed = parseFilterInput('user:alice state:bananas');
    expect(parsed.values).toEqual({ user: 'alice' });
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('bananas');
  });

  test('plain text reports no colon, values, or errors', () => {
    expect(parseFilterInput('alice')).toEqual({ values: {}, validCount: 0, hasColon: false, errors: [] });
  });

  test('colon without a valid pair still reports hasColon', () => {
    const parsed = parseFilterInput('bogus:');
    expect(parsed.validCount).toBe(0);
    expect(parsed.hasColon).toBe(true);
  });
});

describe('isCompoundFilterText', () => {
  test('detects key:value format', () => {
    expect(isCompoundFilterText('user:alice partition:nova')).toBe(true);
    expect(isCompoundFilterText('alice')).toBe(false);
    expect(isCompoundFilterText('')).toBe(false);
  });

  test('id: and jobid: spellings are both compound syntax', () => {
    expect(isCompoundFilterText('id:12345')).toBe(true);
    expect(isCompoundFilterText('jobid:12345')).toBe(true);
    expect(parseFilterInput('id:12345').values).toEqual({ id: '12345' });
    expect(parseFilterInput('jobid:12345').values).toEqual({ id: '12345' });
  });
});

describe('getWordAtCursor', () => {
  test('returns the word under the cursor', () => {
    expect(getWordAtCursor('user:al partition:nova', 7)).toEqual({ word: 'user:al', start: 0 });
    expect(getWordAtCursor('user:alice part', 15)).toEqual({ word: 'part', start: 11 });
  });
});

describe('getSuggestions', () => {
  const partitions = ['nova', 'gpu'];

  test('partition: prefix suggests live partitions', () => {
    expect(getSuggestions({ word: 'partition:n', selectedField: 'user', partitions })).toEqual([
      { id: 'nova', name: 'nova', prefix: 'partition:', kind: 'value' },
    ]);
  });

  test('state: prefix suggests shared job states', () => {
    const suggestions = getSuggestions({ word: 'state:run', selectedField: 'user', partitions });
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('RUNNING');
    expect(suggestions[0]?.prefix).toBe('state:');
  });

  test('statereason: prefix suggests the static reason list', () => {
    const suggestions = getSuggestions({
      word: 'statereason:Pri',
      selectedField: 'user',
      partitions,
    });
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('Priority');
  });

  test('bare words suggest filter keys', () => {
    const suggestions = getSuggestions({ word: 'us', selectedField: 'user', partitions });
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('user:');
    expect(suggestions.find((suggestion) => suggestion.id === 'user:')?.kind).toBe('key');
  });

  test('bare words also suggest values for the selected field', () => {
    const suggestions = getSuggestions({ word: 'a', selectedField: 'partition', partitions });
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('nova');
    expect(suggestions.map((suggestion) => suggestion.id)).toContain('account:');
  });

  test("selected-field values rank above generic keys", () => {
    const partitionFirst = getSuggestions({ word: 'n', selectedField: 'partition', partitions });
    expect(partitionFirst.map((suggestion) => suggestion.id)).toEqual(['nova', 'name:']);

    const stateFirst = getSuggestions({ word: 'p', selectedField: 'state', partitions });
    expect(stateFirst[0]?.kind).toBe('value');
    expect(stateFirst.map((suggestion) => suggestion.id)).toContain('partition:');
  });

  test('free-text keys offer no value suggestions', () => {
    expect(
      getSuggestions({ word: 'user:alice', selectedField: 'user', partitions })
    ).toEqual([]);
    expect(
      getSuggestions({ word: 'unknown:x', selectedField: 'user', partitions })
    ).toEqual([]);
  });
});

describe('insertSuggestion', () => {
  test('replaces the current word and moves the cursor past it', () => {
    const result = insertSuggestion('user:al', 0, 7, {
      id: 'alice',
      name: 'alice',
      prefix: 'user:',
      kind: 'value',
    });
    expect(result).toEqual({ text: 'user:alice', cursorPos: 10 });
  });

  test('key suggestions insert the key plus colon', () => {
    const result = insertSuggestion('us', 0, 2, {
      id: 'user:',
      name: 'user:',
      prefix: '',
      kind: 'key',
    });
    expect(result).toEqual({ text: 'user:', cursorPos: 5 });
  });

  test('only the draft changes; surrounding tokens are preserved', () => {
    const result = insertSuggestion('user:al partition:nova', 0, 7, {
      id: 'alice',
      name: 'alice',
      prefix: 'user:',
      kind: 'value',
    });
    expect(result).toEqual({ text: 'user:alice partition:nova', cursorPos: 10 });
  });
});
