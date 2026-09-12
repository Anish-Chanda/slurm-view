import { appBaseFromPageUrl, routerBasepathFromPageUrl } from '../../src/client/api/base';

describe('appBaseFromPageUrl', () => {
  test.each([
    ['dev root', 'http://localhost:5173/', 'http://localhost:5173/'],
    ['dev nested path', 'http://localhost:5173/some/page', 'http://localhost:5173/some/'],
    ['root react mount', 'https://host/react/', 'https://host/'],
    ['nested OOD react mount', 'https://host/pun/sys/slurm-view/react/', 'https://host/pun/sys/slurm-view/'],
    ['nested OOD root mount', 'https://host/pun/sys/slurm-view/', 'https://host/pun/sys/slurm-view/'],
  ])('%s', (_label, pageUrl, expectedBase) => {
    expect(appBaseFromPageUrl(pageUrl).toString()).toBe(expectedBase);
  });

  test('resolves api paths without escaping the app base', () => {
    const cases: Array<[string, string]> = [
      ['http://localhost:5173/', 'http://localhost:5173/api/v1/jobs?page=1'],
      ['https://host/react/', 'https://host/api/v1/jobs?page=1'],
      [
        'https://host/pun/sys/slurm-view/react/',
        'https://host/pun/sys/slurm-view/api/v1/jobs?page=1',
      ],
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
    ['react job deep link', 'https://host/react/jobs/123', 'https://host/'],
    [
      'OOD react job deep link',
      'https://host/pun/sys/slurm-view/react/jobs/100_2',
      'https://host/pun/sys/slurm-view/',
    ],
    [
      'post-cutover OOD job deep link',
      'https://host/pun/sys/slurm-view/jobs/123',
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
    ['react mount', 'https://host/react/', '/react'],
    ['react job deep link', 'https://host/react/jobs/123', '/react'],
    ['OOD react mount', 'https://host/pun/sys/slurm-view/react/', '/pun/sys/slurm-view/react'],
    [
      'OOD react job deep link',
      'https://host/pun/sys/slurm-view/react/jobs/100_2',
      '/pun/sys/slurm-view/react',
    ],
    ['OOD root mount', 'https://host/pun/sys/slurm-view/', '/pun/sys/slurm-view'],
    [
      'post-cutover OOD job deep link',
      'https://host/pun/sys/slurm-view/jobs/123',
      '/pun/sys/slurm-view',
    ],
  ])('%s', (_label, pageUrl, expectedBasepath) => {
    expect(routerBasepathFromPageUrl(pageUrl)).toBe(expectedBasepath);
  });
});
