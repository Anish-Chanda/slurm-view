import { appBaseFromPageUrl } from '../../src/client/api/base';

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
});
