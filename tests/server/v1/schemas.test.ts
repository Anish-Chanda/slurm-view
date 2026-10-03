import * as fs from 'node:fs';
import * as path from 'node:path';
import { rawJobSchema } from '../../../src/server/adapters/slurm/schemas/jobs.js';
import { nodeResponseSchemaFor } from '../../../src/server/adapters/slurm/schemas/nodes.js';
import type { SupportedDataParser } from '../../../src/server/adapters/slurm/parser-version.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe.each(['v43-jobs.json', 'v44-jobs.json', 'v45-jobs.json'])('targeted job schema (%s)', (file) => {
  test('representative response validates', () => {
    const fixture = JSON.parse(readFixture(file)) as { jobs: unknown[] };
    expect(fixture.jobs.map((job) => rawJobSchema.safeParse(job).success)).toEqual([true, true, true]);
  });

  test('unknown fields are tolerated', () => {
    const parsed = JSON.parse(readFixture(file)) as { jobs: unknown[] };
    expect(rawJobSchema.safeParse(parsed.jobs[0]).success).toBe(true);
  });
});

describe('targeted job record handling', () => {
  test('realistic exit-code status/signal metadata does not fail validation', () => {
    const result = rawJobSchema.safeParse({
      job_id: 1,
      exit_code: {
        return_code: { number: 0, set: true, infinite: false },
        status: ['SUCCESS'],
        signal: {
          id: { number: 0, set: false, infinite: false },
          name: '',
        },
      },
      derived_exit_code: {
        return_code: { number: 0, set: true, infinite: false },
        status: ['SUCCESS'],
        signal: {
          id: { number: 0, set: false, infinite: false },
          name: '',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exit_code?.return_code).toEqual({
        number: 0,
        set: true,
        infinite: false,
      });
      expect(result.data.exit_code).not.toHaveProperty('status');
      expect(result.data.exit_code).not.toHaveProperty('signal');
    }
  });

  test('missing consumed scalar fields are tolerated, missing job_id fails', () => {
    expect(rawJobSchema.safeParse({ partition: 'debug' }).success).toBe(false);
    expect(rawJobSchema.safeParse({ job_id: 1 }).success).toBe(true);
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
