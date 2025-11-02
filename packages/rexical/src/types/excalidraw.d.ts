// Type declarations for excalidraw subpath imports that aren't properly exported
// with moduleResolution: bundler

declare module '@excalidraw/excalidraw/types' {
  export type {
    AppState,
    BinaryFiles,
    ExcalidrawImperativeAPI,
    ExcalidrawInitialDataState,
  } from '@excalidraw/excalidraw';
}

declare module '@excalidraw/excalidraw/element/types' {
  export type {
    ExcalidrawElement,
    NonDeleted,
  } from '@excalidraw/excalidraw';
}
