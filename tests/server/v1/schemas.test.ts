import * as fs from 'node:fs';
import * as path from 'node:path';
import { jobResponseSchemaFor } from '../../../src/server/adapters/slurm/schemas/jobs.js';
import { nodeResponseSchemaFor } from '../../../src/server/adapters/slurm/schemas/nodes.js';
import type { SupportedDataParser } from '../../../src/server/adapters/slurm/parser-version.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe.each([
  ['v0.0.43', 'v43-jobs.json'],
  ['v0.0.44', 'v44-jobs.json'],
  ['v0.0.45', 'v45-jobs.json'],
] as Array<[SupportedDataParser, string]>)('job schemas (%s)', (parser, file) => {
  test('representative response validates', () => {
    const result = jobResponseSchemaFor(parser).safeParse(JSON.parse(readFixture(file)));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobs).toHaveLength(3);
    }
  });

  test('unknown fields are tolerated', () => {
    const parsed = JSON.parse(readFixture(file)) as { jobs: unknown[] };
    const result = jobResponseSchemaFor(parser).safeParse(parsed);
    expect(result.success).toBe(true);
  });
});

describe('job envelope handling', () => {
  const parser = 'v0.0.45' as const;

  test('missing jobs collection fails validation', () => {
    expect(jobResponseSchemaFor(parser).safeParse({ meta: {} }).success).toBe(false);
  });

  test('missing consumed scalar fields are tolerated (nullable), missing job_id fails', () => {
    const emptyJob = jobResponseSchemaFor(parser).safeParse({
      jobs: [{ partition: 'debug' }],
    });
    expect(emptyJob.success).toBe(false);
    const minimal = jobResponseSchemaFor(parser).safeParse({ jobs: [{ job_id: 1 }] });
    expect(minimal.success).toBe(true);
  });

  test('slurm errors/warnings shapes parse', () => {
    const result = jobResponseSchemaFor(parser).safeParse({
      jobs: [],
      errors: [{ description: 'Unable to contact controller', error_code: 123 }],
      warnings: [{ message: 'clock skew?' }],
    });
    expect(result.success).toBe(true);
  });
});

describe.each([
  ['v0.0.43', 'v43-nodes.json'],
  ['v0.0.44', 'v44-nodes.json'],
  ['v0.0.45', 'v45-nodes.json'],
] as Array<[SupportedDataParser, string]>)('node schemas (%s)', (parser, file) => {
  test('representative response validates', () => {
    const result = nodeResponseSchemaFor(parser).safeParse(JSON.parse(readFixture(file)));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes).toHaveLength(4);
    }
  });
});

describe('node envelope handling', () => {
  const parser = 'v0.0.45' as const;

  test('missing nodes collection fails; nameless node fails', () => {
    expect(nodeResponseSchemaFor(parser).safeParse({}).success).toBe(false);
    expect(nodeResponseSchemaFor(parser).safeParse({ nodes: [{ state: ['IDLE'] }] }).success).toBe(false);
  });
});
