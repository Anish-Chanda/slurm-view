import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Project-wide query policy: no implicit network activity. Queries never
// refetch merely because a stale observer mounts, the tab regains focus,
// or the network reconnects. Staleness and refresh triggers stay separate
// concerns: each data type owns its staleTime/gcTime, and genuinely live
// surfaces (jobs queue, cluster stats) explicitly opt into polling via
// refetchInterval at their own call sites.
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });
}

const queryClient = createQueryClient();

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export { Providers, createQueryClient, queryClient };
