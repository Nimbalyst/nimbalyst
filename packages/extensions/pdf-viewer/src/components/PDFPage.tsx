import { useRef, useEffect, useState } from 'react';
import type { PDFDocumentProxy } from '../hooks/usePDFDocument';

interface PDFPageProps {
  document: PDFDocumentProxy | null;
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
}

export function PDFPage({ document, pageNumber, scale, width, height }: PDFPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!document || !canvasRef.current) return;

    let cancelled = false;
    setRendering(true);

    const renderPage = async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        const viewport = page.getViewport({ scale });

        // Set canvas dimensions
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Render the page
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext).promise;
        if (!cancelled) {
          setRendering(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(`Error rendering page ${pageNumber}:`, err);
          setRendering(false);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
    };
  }, [document, pageNumber, scale]);

  return (
    <div className="pdf-page" style={{ width, height, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%' }} />
      {rendering && (
        <div className="pdf-page-loading" style={{ position: 'absolute' }}>
          Loading...
        </div>
      )}
    </div>
  );
}
