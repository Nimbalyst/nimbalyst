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

declare module '@excalidraw/excalidraw/types/types' {
  export type ExcalidrawElement = any;
  export type NonDeleted<T> = T & { isDeleted: false };
  export type Collaborator = { pointer?: any; button?: any; selectedElementIds?: any; username?: string; userState?: any; color?: any; avatarUrl?: string; id?: string };
  export type AppState = Record<string, any>;
  export type BinaryFiles = Record<string, any>;
  export type ExcalidrawImperativeAPI = {
    updateScene: (scene: any) => void;
    getSceneElements: () => ExcalidrawElement[];
    getAppState: () => AppState;
    getFiles: () => BinaryFiles;
    scrollToContent: (elements?: ExcalidrawElement[], opts?: any) => void;
    resetScene: (opts?: any) => void;
    [key: string]: any;
  };
  export type ExcalidrawInitialDataState = {
    elements?: ExcalidrawElement[];
    appState?: Partial<AppState>;
    files?: BinaryFiles;
    collaborators?: Map<string, Collaborator>;
  };
}

declare module '@excalidraw/excalidraw/element/types' {
  export type {
    ExcalidrawElement,
    NonDeleted,
  } from '@excalidraw/excalidraw';
}
