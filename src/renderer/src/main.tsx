import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PipChrome } from './pip/PipChrome'
import { LayerSurface } from './layer/LayerSurface'
import './styles/global.css'

// El mismo bundle sirve tres superficies: el shell normal, la barra del
// mini-player (`?surface=pip`) y la capa flotante con el menu ☰, Descargas e
// Historial (`?surface=layer`), cada una en su propia vista nativa.
const surface = new URLSearchParams(window.location.search).get('surface')
// La capa flotante es transparente: su CSS se engancha a esta marca.
if (surface === 'layer') document.documentElement.dataset.surface = 'layer'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {surface === 'pip' ? <PipChrome /> : surface === 'layer' ? <LayerSurface /> : <App />}
  </StrictMode>
)
