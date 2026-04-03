'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthProvider } from '@/context/auth-context';
import { RouteTransitionLoader } from '@/components/route-transition-loader';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data stays fresh for 60 s — no re-fetch on every mount or focus.
            staleTime: 60_000,
            // Keep unused cache entries for 10 min so navigating back is instant.
            gcTime: 10 * 60_000,
            // Never re-fetch just because the user alt-tabs back.
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouteTransitionLoader />
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
