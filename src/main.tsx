// Self-hosted OFL fonts (ADR D4) — no font CDN requests at runtime.
import '@fontsource-variable/inter/wght.css'
import '@fontsource/press-start-2p/latin-400.css'
import './styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { router } from './app/router'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
