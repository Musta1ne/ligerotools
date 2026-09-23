import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const isPrototype =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('proto-landing')
const PrototypeLanding = lazy(() =>
  import('./prototype-landing.tsx').then((module) => ({ default: module.PrototypeLanding })),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPrototype ? (
      <Suspense fallback={<p>Cargando prototipo…</p>}>
        <PrototypeLanding />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
