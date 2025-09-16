import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './ui/tailwind.css';
import './ui/styles.css';

const wasmUrl = new URL('../node_modules/@electric-sql/pglite/dist/pglite.wasm', import.meta.url).href;
const dataUrl = new URL('../node_modules/@electric-sql/pglite/dist/pglite.data', import.meta.url).href;
const assetBase = wasmUrl.slice(0, wasmUrl.lastIndexOf('/') + 1);
const globals = window as any;
globals.__PGLITE_ASSET_BASE__ = assetBase;
globals.__PGLITE_WASM_URL__ = wasmUrl;
globals.__PGLITE_DATA_URL__ = dataUrl;
globals.__PGLITE_DEV_WASM__ = wasmUrl;
globals.__PGLITE_DEV_DATA__ = dataUrl;
// eslint-disable-next-line no-console
console.log('[cap] Using PGlite asset URLs', {
  wasm: globals.__PGLITE_WASM_URL__,
  data: globals.__PGLITE_DATA_URL__
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
