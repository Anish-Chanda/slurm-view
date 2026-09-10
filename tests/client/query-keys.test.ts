import { jobsKeys, partitionKeys, statsKeys, uiSettingsKeys } from '../../src/client/api/query-keys';

describe('query keys', () => {
  test('jobs list key contains every server-side input and omits unset filters', () => {
    const key = jobsKeys.list({ page: 2, pageSize: 20, user: 'bob' });
    expect(key[0]).toBe('jobs');
    expect(key[1]).toBe('list');
    expect(key[2]).toMatchObject({ page: 2, pageSize: 20, user: 'bob' });
    expect(key[2]).not.toHaveProperty('partition');
    expect(key[2]).not.toHaveProperty('state');
  });

  test('different pages and filters produce different keys', () => {
    expect(jobsKeys.list({ page: 1, pageSize: 20 })).not.toEqual(
      jobsKeys.list({ page: 2, pageSize: 20 })
    );
    expect(jobsKeys.list({ page: 1, pageSize: 20 })).not.toEqual(
      jobsKeys.list({ page: 1, pageSize: 20, state: 'RUNNING' })
    );
  });

  test('stats key contains the partition, including null for cluster-wide', () => {
    expect(statsKeys.detail(null)).toEqual(['stats', 'detail', { partition: null }]);
    expect(statsKeys.detail('gpu')).toEqual(['stats', 'detail', { partition: 'gpu' }]);
  });

  test('partitions has its own key', () => {
    expect(partitionKeys.list).toEqual(['partitions', 'list']);
  });

  test('ui-settings has a single stable key (fetched once, cached indefinitely)', () => {
    expect(uiSettingsKeys.detail).toEqual(['ui-settings', 'detail']);
  });
});
