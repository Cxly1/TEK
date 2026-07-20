import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PipChrome } from './pip/PipChrome'
import './styles/global.css'

// El mismo bundle sirve dos superficies: el shell normal y la barra del
// mini-player (Picture-in-Picture), que se carga con `?surface=pip` en su
// propia vista nativa.
const surface = new URLSearchParams(window.location.search).get('surface')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{surface === 'pip' ? <PipChrome /> : <App />}</StrictMode>
)
