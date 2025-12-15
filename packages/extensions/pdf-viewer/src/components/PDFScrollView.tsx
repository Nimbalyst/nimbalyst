import { PDFPage } from './PDFPage';
import type { PDFDocumentProxy } from '../hooks/usePDFDocument';

// Get virtua from the host
const { VList } = (window as any).__nimbalyst_extensions.virtua;

interface PDFScrollViewProps {
  document: PDFDocumentProxy | null;
  totalPages: number;
  scale: number;
  theme: 'light' | 'dark' | 'crystal-dark';
}

export function PDFScrollView({ document, totalPages, scale, theme }: PDFScrollViewProps) {
  // Calculate page dimensions (standard US Letter PDF page aspect ratio)
  const PAGE_WIDTH = 612; // US Letter width in points
  const PAGE_HEIGHT = 792; // US Letter height in points
  const scaledWidth = PAGE_WIDTH * scale;
  const scaledHeight = PAGE_HEIGHT * scale;
  const GAP = 16; // Gap between pages

  if (!document) {
    return (
      <div className="pdf-scroll-container" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>No document loaded</div>
      </div>
    );
  }

  // Create array of page numbers
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div
      className="pdf-scroll-container"
      style={{
        height: '100%',
        backgroundColor: 'var(--surface-secondary)',
      }}
    >
      <VList
        style={{ height: '100%' }}
        overscan={2}
      >
        {pages.map((pageNumber) => (
          <div
            key={pageNumber}
            style={{
              display: 'flex',
              justifyContent: 'center',
              paddingTop: `${GAP / 2}px`,
              paddingBottom: `${GAP / 2}px`,
            }}
          >
            <PDFPage
              document={document}
              pageNumber={pageNumber}
              scale={scale}
              width={scaledWidth}
              height={scaledHeight}
            />
          </div>
        ))}
      </VList>
    </div>
  );
}
