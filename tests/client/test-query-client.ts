import { QueryClient } from '@tanstack/react-query';
import { createQueryClient } from '../../src/client/app/providers';

interface TestQueryOverrides {
  retry?: boolean | number | ((failureCount: number, error: unknown) => boolean);
  retryDelay?: number;
}

// Keep production query defaults while applying test-only overrides.
// setDefaultOptions replaces defaults wholesale, so merge them here once.
function createTestQueryClient(overrides: TestQueryOverrides = {}): QueryClient {
  const client = createQueryClient();
  const current = client.getDefaultOptions().queries ?? {};
  client.setDefaultOptions({ queries: { ...current, ...overrides } });
  return client;
}

export { createTestQueryClient };
