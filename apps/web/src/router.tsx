import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { Pending } from './components/Brand';

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true, defaultPendingComponent: Pending });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
