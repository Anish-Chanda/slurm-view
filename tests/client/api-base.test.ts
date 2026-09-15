import { appBaseFromPageUrl, routerBasepathFromPageUrl } from '../../src/client/api/base';

describe('appBaseFromPageUrl', () => {
  test.each([
    ['dev root', 'http://localhost:5173/', 'http://localhost:5173/'],
    ['dev nested path', 'http://localhost:5173/some/page', 'http://localhost:5173/some/'],
    ['nested OOD root mount', 'https://host/pun/sys/slurm-view/', 'https://host/pun/sys/slurm-view/'],
  ])('%s', (_label, pageUrl, expectedBase) => {
    expect(appBaseFromPageUrl(pageUrl).toString()).toBe(expectedBase);
  });

  test('resolves api paths without escaping the app base', () => {
    const cases: Array<[string, string]> = [
      ['http://localhost:5173/', 'http://localhost:5173/api/v1/jobs?page=1'],
      [
        'https://host/pun/sys/slurm-view/',
        'https://host/pun/sys/slurm-view/api/v1/jobs?page=1',
      ],
    ];
    for (const [pageUrl, expected] of cases) {
      const api = new URL('api/v1/jobs?page=1', appBaseFromPageUrl(pageUrl)).toString();
      expect(api).toBe(expected);
    }
  });

  test.each([
    ['dev root', 'http://localhost:5173/', 'http://localhost:5173/'],
    ['dev job deep link', 'http://localhost:5173/jobs/123', 'http://localhost:5173/'],
    [
      'OOD job deep link',
      'https://host/pun/sys/slurm-view/jobs/123',
      'https://host/pun/sys/slurm-view/',
    ],
    [
      'OOD array task deep link',
      'https://host/pun/sys/slurm-view/jobs/100_2',
      'https://host/pun/sys/slurm-view/',
    ],
  ])('app base from %s', (_label, pageUrl, expectedBase) => {
    expect(appBaseFromPageUrl(pageUrl).toString()).toBe(expectedBase);
  });
});

describe('routerBasepathFromPageUrl', () => {
  test.each([
    ['dev root', 'http://localhost:5173/', '/'],
    ['dev job deep link', 'http://localhost:5173/jobs/123', '/'],
    ['OOD root mount', 'https://host/pun/sys/slurm-view/', '/pun/sys/slurm-view'],
    [
      'OOD job deep link',
      'https://host/pun/sys/slurm-view/jobs/123',
      '/pun/sys/slurm-view',
    ],
  ])('%s', (_label, pageUrl, expectedBasepath) => {
    expect(routerBasepathFromPageUrl(pageUrl)).toBe(expectedBasepath);
  });
});
