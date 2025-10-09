/// <reference types="vite/client" />
/// <reference path="../../electron/src/renderer/electron.d.ts" />

declare module '*.css?inline' {
  const content: string;
  export default content;
}
