import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo-narrow/400.css';
import '@fontsource/archivo-narrow/600.css';
// Material Symbols Rounded is self-hosted and SUBSET to our ~29 icons (24 KB vs
// the 4.6 MB full font) — see scripts/subset-icons.py. @font-face + the base
// class live in theme.css; the codepoint map is src/components/iconCodepoints.ts.
import './theme/theme.css';
import { App } from './App';
import { registerServiceWorker } from './data/sync/registerServiceWorker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Caches the app shell so a primed install reopens offline (REL-04).
registerServiceWorker();
