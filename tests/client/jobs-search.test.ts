import { EMPTY_FILTERS } from '../../src/client/features/jobs/JobsFilters';
import {
  dashboardSearchParams,
  parseDashboardSearch,
  readDashboardSearch,
} from '../../src/client/features/jobs/jobs-search';

describe('parseDashboardSearch', () => {
  test('parses a full dashboard URL state into canonical search', () => {
    expect(
      parseDashboardSearch({
        page: '2',
        pageSize: '50',
        id: '101',
        partition: 'gpu',
        name: 'train',
        user: 'alice',
        account: 'lab',
        state: 'RUNNING',
        stateReason: 'Resources',
      })
    ).toEqual({
      page: 2,
      pageSize: 50,
      id: '101',
      partition: 'gpu',
      name: 'train',
      user: 'alice',
      account: 'lab',
      state: 'RUNNING',
      stateReason: 'Resources',
    });
  });

  test('drops invalid values and defaults the page', () => {
    expect(parseDashboardSearch({ page: 'abc', pageSize: '500', partition: 'a;b', state: 'BOGUS' })).toEqual({
      page: 1,
      pageSize: 20,
    });
  });

  test('accepts numeric values from router state', () => {
    expect(parseDashboardSearch({ page: 3, pageSize: 10 })).toEqual({ page: 3, pageSize: 10 });
  });

  test('is idempotent on canonical search', () => {
    const once = parseDashboardSearch({ page: '2', user: 'alice' });
    expect(parseDashboardSearch(once)).toEqual(once);
  });
});

describe('readDashboardSearch', () => {
  test('maps canonical search to filter state', () => {
    expect(readDashboardSearch({ page: 2, pageSize: 50, user: 'alice', state: 'RUNNING' })).toEqual({
      filters: { ...EMPTY_FILTERS, user: 'alice', state: 'RUNNING' },
      page: 2,
      pageSize: 50,
    });
  });
});

describe('dashboardSearchParams', () => {
  test('round-trips through parseDashboardSearch', () => {
    const params = dashboardSearchParams({ ...EMPTY_FILTERS, user: 'alice', state: 'RUNNING' }, 2, 50);
    expect(parseDashboardSearch(params)).toEqual(params);
  });

  test('omits empty filters', () => {
    expect(dashboardSearchParams({ ...EMPTY_FILTERS }, 1, 20)).toEqual({ page: 1, pageSize: 20 });
  });
});
