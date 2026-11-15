import React from 'react';
import ReactDOM from 'react-dom/client';
import { tauriBridge } from './services/tauriBridge';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

// Единое окно `overlay` (Windows) рендерится без стора и БОС-движка; движок
// работает только в `main` (или в браузере), иначе сигнал считался бы дважды.
const isUnifiedOverlay = tauriBridge.windowLabel() === 'overlay';

const loadRoot = isUnifiedOverlay
  ? import('./OverlayApp').then((m) => m.OverlayApp)
  : Promise.all([
      import('./App'),
      import('./services/overlayPublisher'),
    ]).then(([appMod, pubMod]) => {
      if (tauriBridge.isTauri()) {
        pubMod.startOverlayPublisher();
      }
      return appMod.App;
    });

void loadRoot.then((Root) => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
});
