import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { usePlayerStore } from './state/playerStore'
import './styles.css'

// The smoke runner drives the app through this handle; see src/main/smoke.ts.
if (new URLSearchParams(window.location.search).has('smoke')) {
  Reflect.set(window, '__equipStore', usePlayerStore)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
