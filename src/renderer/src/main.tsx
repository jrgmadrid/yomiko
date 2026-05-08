import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import TestVN from './TestVN'
import PopupRoot from './PopupRoot'

const params = new URLSearchParams(window.location.search)
const mode = params.get('mode')

const Component =
  mode === 'test-vn' ? TestVN : mode === 'popup' ? PopupRoot : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Component />
  </StrictMode>
)
