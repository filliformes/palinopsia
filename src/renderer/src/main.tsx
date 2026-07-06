import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OutputView } from './components/OutputView'
import './styles.css'

// The projector/output window loads the same bundle with a #output hash — it
// renders only the mirror <video>, never the full control UI or a 2nd engine.
const isOutput = window.location.hash.replace('#', '') === 'output'

createRoot(document.getElementById('root')!).render(
  isOutput ? (
    <OutputView />
  ) : (
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
)
