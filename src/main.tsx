import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { startOverlayPublisher } from './services/overlayPublisher';

// The engine lives in this window; with native overlay windows present it feeds them its state.
if ('__TAURI_INTERNALS__' in window) {
  startOverlayPublisher();
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
