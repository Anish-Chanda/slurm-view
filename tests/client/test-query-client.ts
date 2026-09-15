import { QueryClient } from '@tanstack/react-query';
import { createQueryClient } from '../../src/client/app/providers';

interface TestQueryOverrides {
  retry?: boolean | number | ((failureCount: number, error: unknown) => boolean);
  retryDelay?: number;
}

// Test clients keep the production query policy (no implicit mount, focus,
// or reconnect refetching) and layer test-only overrides on top.
// QueryClient.setDefaultOptions replaces defaults wholesale, so merge
// explicitly here instead of duplicating the policy in every suite.
function createTestQueryClient(overrides: TestQueryOverrides = {}): QueryClient {
  const client = createQueryClient();
  const current = client.getDefaultOptions().queries ?? {};
  client.setDefaultOptions({ queries: { ...current, ...overrides } });
  return client;
}

export { createTestQueryClient };
