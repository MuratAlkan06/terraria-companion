import { createBrowserRouter, type RouteObject } from 'react-router'
import { APP_ROUTES } from './routes'
import NotFoundPage from './routes/NotFoundPage'
import RouteErrorPage from './routes/RouteErrorPage'
import AppShell from './shell/AppShell'
import { publishRouterLocation } from './shell/navigationPending'

/** Registry entry -> React Router child of the shell ("/" becomes the index route). */
function toRouteObject({ path, Component }: (typeof APP_ROUTES)[number]): RouteObject {
  return path === '/' ? { index: true, Component } : { path: path.replace(/^\//, ''), Component }
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    // Last-resort boundary if the shell itself fails.
    ErrorBoundary: RouteErrorPage,
    children: [
      {
        // Pathless boundary keeps the shell alive when a page (or its lazy chunk) fails.
        ErrorBoundary: RouteErrorPage,
        children: [...APP_ROUTES.map(toRouteObject), { path: '*', Component: NotFoundPage }],
      },
    ],
  },
])

// The shell's pending-navigation indicator compares this with the committed location.
publishRouterLocation(router.state.location.key)
router.subscribe((state) => publishRouterLocation(state.location.key))
