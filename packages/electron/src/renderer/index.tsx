// console.log('[RENDERER] index.tsx executing at', new Date().toISOString());

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// console.log('[RENDERER] Imports complete at', new Date().toISOString());

const rootElement = document.getElementById('root') as HTMLElement;
// console.log('[RENDERER] Root element:', rootElement, 'at', new Date().toISOString());

const root = ReactDOM.createRoot(rootElement);
// console.log('[RENDERER] React root created at', new Date().toISOString());

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// console.log('[RENDERER] React render called at', new Date().toISOString());
