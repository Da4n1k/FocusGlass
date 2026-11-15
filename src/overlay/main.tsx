import React from 'react';
import ReactDOM from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
import '../index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>
);
