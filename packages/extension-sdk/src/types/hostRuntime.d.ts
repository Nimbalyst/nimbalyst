declare module '@nimbalyst/runtime' {
  export function useDocumentPath(): {
    documentPath: string | null;
    documentDir: string | null;
  };

  export function MaterialSymbol(props: {
    icon: string;
    size?: number;
    fill?: boolean;
    weight?: number;
    grade?: number;
    opticalSize?: number;
    className?: string;
    title?: string;
    style?: import('react').CSSProperties;
  }): import('react').ReactElement | null;
}
