import {
  parsePartitionTableStdout,
} from '../../../src/server/adapters/slurm/partition-detail.js';

function envelope(partitions: unknown): string {
  return JSON.stringify({
    meta: {
      plugin: {
        data_parser: 'data_parser/v0.0.43',
      },
    },
    errors: [],
    warnings: [],
    partitions,
  });
}

describe('parsePartitionTableStdout', () => {
  test('parses the Slurm data_parser/v0.0.43 nested partition shape', () => {
    const result = parsePartitionTableStdout(
      envelope([
        {
          name: 'compute',
          qos: {
            allowed: '',
            deny: '',
            assigned: '',
          },
          partition: {
            state: ['UP'],
          },
          maximums: {
            time: {
              set: true,
              infinite: false,
              number: 720,
            },
            nodes: {
              set: false,
              infinite: true,
              number: 0,
            },
          },
          nodes: {
            total: 8,
          },
        },
      ])
    );

    expect(result).toEqual([
      {
        name: 'compute',
        state: 'UP',
        maxTimeSeconds: 43_200,
        maxNodes: null,
        totalNodes: 8,
        qos: null,
      },
    ]);
  });

  test('uses qos.assigned as the effective partition QOS', () => {
    const result = parsePartitionTableStdout(
      envelope([
        {
          name: 'compute',
          qos: {
            allowed: 'normal,memcap',
            deny: '',
            assigned: 'memcap',
          },
          partition: {
            state: ['UP'],
          },
          maximums: {},
          nodes: {
            total: 8,
          },
        },
      ])
    );

    expect(result[0]?.qos).toBe('memcap');
  });


});
