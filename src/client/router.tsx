import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen.ts';
import { queryClient } from './app/providers.tsx';
import { routerBasepathFromPageUrl } from './api/base.ts';

export const router = createRouter({
  routeTree,
  basepath: routerBasepathFromPageUrl(window.location.href),
  context: { queryClient },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
