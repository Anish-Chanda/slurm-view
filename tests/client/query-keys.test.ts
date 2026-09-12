import { efficiencyKeys, jobsKeys, partitionKeys, statsKeys, uiSettingsKeys } from '../../src/client/api/query-keys';
import { EFFICIENCY_GC_TIME_MS, EFFICIENCY_STALE_TIME_MS } from '../../src/client/api/efficiency';
import { efficiencyQueryOptions } from '../../src/client/api/efficiency';
import { jobDetailQueryOptions } from '../../src/client/api/job-details';

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

  test('job detail keys are per canonical ID', () => {
    expect(jobsKeys.detail('101')).toEqual(['jobs', 'detail', { id: '101' }]);
    expect(jobsKeys.detail('101')).not.toEqual(jobsKeys.detail('100_2'));
  });

  test('efficiency keys are per job ID', () => {
    expect(efficiencyKeys.detail('103')).toEqual(['efficiency', 'detail', { id: '103' }]);
  });

  test('efficiency uses finite freshness without polling', () => {
    expect(EFFICIENCY_STALE_TIME_MS).toBe(10 * 60 * 1000);
    expect(EFFICIENCY_GC_TIME_MS).toBe(30 * 60 * 1000);
    const options = efficiencyQueryOptions('103');
    expect(options.staleTime).toBe(EFFICIENCY_STALE_TIME_MS);
    expect(options.gcTime).toBe(EFFICIENCY_GC_TIME_MS);
    expect(options.refetchInterval).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
  });

  test('job detail options never use placeholder data', () => {
    const options = jobDetailQueryOptions('101');
    expect(options).not.toHaveProperty('placeholderData');
    expect(options.staleTime).toBe(30_000);
  });
});
