// Self-hosted OFL fonts (ADR D4) — no font CDN requests at runtime.
import '@fontsource-variable/inter/wght.css'
import '@fontsource/press-start-2p/latin-400.css'
import './styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { router } from './app/router'
import { resumeRetryFocus } from './components/retryFocus'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// After a Retry that had to reload the page: focus where that Retry would have put it (AMENDMENTS-016 B114 M7).
resumeRetryFocus()
