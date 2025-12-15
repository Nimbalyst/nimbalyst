import { useState, useEffect } from 'react';

// Get PDF.js from the host
const pdfjsLib = (window as any).__nimbalyst_extensions['pdfjs-dist'];

export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  getMetadata(): Promise<any>;
}

export interface PDFPageProxy {
  getViewport(params: { scale: number }): PDFViewport;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PDFViewport }): { promise: Promise<void> };
  getTextContent(): Promise<any>;
}

export interface PDFViewport {
  width: number;
  height: number;
  scale: number;
}

export interface UsePDFDocumentResult {
  document: PDFDocumentProxy | null;
  totalPages: number;
  loading: boolean;
  error: string | null;
}

export function usePDFDocument(filePath: string): UsePDFDocumentResult {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPDF = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!pdfjsLib) {
          throw new Error('PDF.js library not available');
        }

        // Configure worker - PDF.js needs a worker to parse PDFs without blocking the main thread
        // The worker is loaded as a blob URL by the activation function
        // Wait for the worker URL to be available (with timeout)
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          let attempts = 0;
          while (!((window as any).__pdfViewerWorkerUrl) && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 50));
            attempts++;
          }

          const workerUrl = (window as any).__pdfViewerWorkerUrl;
          if (workerUrl) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
            console.log('[PDF Viewer] Worker configured with blob URL');
          } else {
            throw new Error('PDF.js worker URL not available after waiting');
          }
        }

        // Read the PDF file content using Electron API
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI?.readFileContent) {
          throw new Error('File reading API not available');
        }

        // Request binary mode explicitly for PDF files
        const result = await electronAPI.readFileContent(filePath, { binary: true });
        if (!result || !result.success) {
          throw new Error(result?.error || 'Failed to read PDF file');
        }

        // Convert base64 content to Uint8Array for PDF.js
        const binaryString = atob(result.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Load the PDF document from binary data
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;

        if (cancelled) return;

        setDocument(pdf);
        setTotalPages(pdf.numPages);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          console.error('Error loading PDF:', err);
          setError(err.message || 'Failed to load PDF');
          setLoading(false);
        }
      }
    };

    loadPDF();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return { document, totalPages, loading, error };
}
