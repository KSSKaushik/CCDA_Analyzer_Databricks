import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import CCDAAnalyzer from './ccda/CCDAAnalyzer.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CCDAAnalyzer />
  </StrictMode>,
)
