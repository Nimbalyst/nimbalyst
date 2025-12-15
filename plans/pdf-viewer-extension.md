---
planStatus:
  planId: plan-pdf-viewer-extension
  title: PDF Viewer Extension for Nimbalyst
  status: in-development
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - extensions
    - pdf
    - file-viewer
    - document-viewer
  created: "2025-12-15"
  updated: "2025-12-15T09:15:00.000Z"
  progress: 45
  startDate: "2025-12-15"
---
# PDF Viewer Extension for Nimbalyst

## Implementation Progress

### Phase 1: Core Scrolling Viewer
- [x] Create extension project structure
- [x] Add pdfjs-dist to host dependencies and expose in window.__nimbalyst_extensions
- [x] Implement PDFViewerEditor component
- [x] Implement usePDFDocument hook
- [x] Implement PDFScrollView with virtual scrolling
- [x] Implement PDFPage component
- [x] Add basic zoom controls
- [x] Create manifest.json
- [x] Add theme-aware CSS

### Phase 2: UI Polish and Features
- [ ] Implement Toolbar component with zoom controls
- [ ] Add keyboard shortcuts (zoom)
- [ ] Add loading states and error handling
- [ ] Implement text layer for selection/copying
- [ ] Optimize rendering performance
- [ ] Add fit-to-width calculation
- [ ] Polish scrolling behavior

### Phase 3: Testing and Documentation
- [ ] Write extension tests
- [ ] Test with various PDF files
- [ ] Test virtual scrolling with large PDFs (100+ pages)
- [ ] Write user documentation
- [ ] Create developer documentation

## Overview

Create a native PDF viewer extension for Nimbalyst that allows users to view PDF files directly within the application without requiring external applications. This extension will demonstrate the custom editor capabilities of the Nimbalyst extension system and provide a valuable feature for users who frequently reference PDF documentation.

## Goals

1. Enable in-app viewing of PDF files
2. Provide a smooth, responsive reading experience with continuous scrolling
3. Integrate seamlessly with Nimbalyst's theme system
4. Support basic PDF navigation (zooming, text selection)
5. Demonstrate the extension system's capabilities as a reference implementation

## Motivation

Users often work with documentation, specifications, and reference materials in PDF format. Currently, these files must be opened in external applications, breaking the workflow. A native PDF viewer would:

- Reduce context switching
- Keep all project documentation in one place
- Serve as a reference for other document viewer extensions

## Technical Approach

### Extension Architecture

**Extension Structure:**
```
packages/extensions/pdf-viewer/
├── manifest.json
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── index.tsx              # Entry point
│   ├── PDFViewerEditor.tsx    # Main viewer component
│   ├── components/
│   │   ├── PDFPage.tsx        # Individual page renderer
│   │   ├── PDFScrollView.tsx  # Virtual scrolling container
│   │   └── Toolbar.tsx        # Zoom controls
│   ├── hooks/
│   │   └── usePDFDocument.ts  # PDF.js integration
│   └── styles/
│       └── index.css          # Theme-aware styles
└── dist/
    ├── index.js
    └── index.css
```

### PDF Rendering Library

Use **PDF.js** (Mozilla's PDF viewer library):
- Industry-standard, maintained by Mozilla
- Pure JavaScript, no external dependencies
- Canvas-based rendering
- Text layer extraction support
- Well-documented API
- TypeScript types available

**Host Dependencies:**
- Add `pdfjs-dist` to Nimbalyst's host dependencies
- Add `@tanstack/react-virtual` for virtual scrolling
- Expose via `window.__nimbalyst_extensions.pdfjs` and `window.__nimbalyst_extensions['@tanstack/react-virtual']`
- Mark as externals in extension's Vite config

### Component Design

**PDFViewerEditor Component:**

```typescript
export function PDFViewerEditor(props: CustomEditorComponentProps) {
  const {
    filePath,
    theme,
    isActive,
    onGetContentReady,
    onDirtyChange
  } = props;

  const { document, totalPages, loading, error } = usePDFDocument(filePath);
  const [scale, setScale] = useState(1.0);

  // PDFs are read-only, so content never changes
  useEffect(() => {
    onGetContentReady?.(() => ''); // No content to save
    onDirtyChange?.(false);        // Never dirty
  }, []);

  // Render continuous scrolling PDF with virtual scrolling
  return (
    <div className={`pdf-viewer-editor theme-${theme}`}>
      <Toolbar
        totalPages={totalPages}
        scale={scale}
        onScaleChange={setScale}
      />
      <PDFScrollView
        document={document}
        totalPages={totalPages}
        scale={scale}
        theme={theme}
      />
    </div>
  );
}
```

**PDFScrollView Component with Virtual Scrolling:**

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function PDFScrollView({ document, totalPages, scale, theme }) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Calculate page dimensions (standard PDF page aspect ratio)
  const PAGE_WIDTH = 612; // US Letter width in points
  const PAGE_HEIGHT = 792; // US Letter height in points
  const scaledWidth = PAGE_WIDTH * scale;
  const scaledHeight = PAGE_HEIGHT * scale;
  const GAP = 16; // Gap between pages

  const virtualizer = useVirtualizer({
    count: totalPages,
    getScrollElement: () => parentRef.current,
    estimateSize: () => scaledHeight + GAP,
    overscan: 2, // Render 2 pages above/below viewport
  });

  return (
    <div
      ref={parentRef}
      className="pdf-scroll-container"
      style={{
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <PDFPage
              document={document}
              pageNumber={virtualItem.index + 1}
              scale={scale}
              width={scaledWidth}
              height={scaledHeight}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**PDFPage Component:**

```typescript
function PDFPage({ document, pageNumber, scale, width, height }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!document || !canvasRef.current) return;

    let cancelled = false;
    setRendering(true);

    const renderPage = async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      await page.render(renderContext).promise;
      if (!cancelled) setRendering(false);
    };

    renderPage();

    return () => {
      cancelled = true;
    };
  }, [document, pageNumber, scale]);

  return (
    <div className="pdf-page" style={{ width, height }}>
      <canvas ref={canvasRef} />
      {rendering && <div className="pdf-page-loading">Loading...</div>}
    </div>
  );
}
```

**usePDFDocument Hook:**

```typescript
function usePDFDocument(filePath: string) {
  const [document, setDocument] = useState<PDFDocument | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPDF = async () => {
      try {
        const pdfjs = window.__nimbalyst_extensions.pdfjs;
        const loadingTask = pdfjs.getDocument(filePath);
        const pdf = await loadingTask.promise;
        setDocument(pdf);
        setTotalPages(pdf.numPages);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    loadPDF();
  }, [filePath]);

  return { document, totalPages, loading, error };
}
```

### Manifest Configuration

```json
{
  "id": "com.nimbalyst.pdf-viewer",
  "name": "PDF Viewer",
  "version": "1.0.0",
  "description": "View PDF files directly in Nimbalyst",
  "author": "Nimbalyst Team",
  "main": "dist/index.js",
  "styles": "dist/index.css",
  "apiVersion": "1.0.0",
  "permissions": {
    "filesystem": true
  },
  "contributions": {
    "customEditors": [
      {
        "filePatterns": ["*.pdf"],
        "displayName": "PDF Viewer",
        "component": "PDFViewerEditor"
      }
    ],
    "fileIcons": [
      {
        "pattern": "*.pdf",
        "icon": "picture_as_pdf",
        "color": "#FF0000"
      }
    ]
  }
}
```

## Features

### Core Features (MVP)

1. **Continuous Scrolling PDF View**
  - Virtual scrolling using `@tanstack/react-virtual`
  - Smooth continuous page flow (like modern PDF viewers)
  - Only renders visible pages + 2 pages overscan
  - Natural reading experience

2. **High-Quality Rendering**
  - Canvas-based rendering via PDF.js
  - Crisp text and graphics
  - Fast page load times

3. **Zoom Controls**
  - Fit to width (default)
  - Custom zoom levels (50%, 75%, 100%, 125%, 150%, 200%)
  - Keyboard shortcuts (Cmd+Plus, Cmd+Minus, Cmd+0)
  - Zoom controls in toolbar

4. **Theme Integration**
  - Respect Nimbalyst's light/dark/crystal-dark themes
  - Theme-aware toolbar and controls
  - Proper contrast for PDF pages in dark mode

5. **Read-Only Display**
  - No dirty state (PDFs are read-only)
  - No save operations
  - Clear visual treatment

6. **Text Selection**
  - Select and copy text from PDF
  - PDF.js text layer support

### Future Enhancement Ideas

1. **Search functionality** - Text search within PDF with highlights
2. **Annotations** - View PDF annotations (if any)
3. **Bookmarks/Outline** - Navigate via PDF table of contents
4. **Print support** - Print PDF directly from Nimbalyst
5. **Thumbnail sidebar** - Visual page navigation
6. **Page links** - Follow internal PDF links

## Implementation Plan

### Phase 1: Core Scrolling Viewer

**Tasks:**
1. Create extension project structure
2. Add PDF.js and @tanstack/react-virtual to host dependencies
3. Implement PDFViewerEditor component
4. Implement usePDFDocument hook
5. Implement PDFScrollView with virtual scrolling
6. Implement PDFPage component
7. Add basic zoom controls
8. Create manifest.json
9. Add theme-aware CSS

**Deliverables:**
- Working continuous scrolling PDF viewer
- Virtual scrolling performance
- Theme integration
- Extension manifest

### Phase 2: UI Polish and Features

**Tasks:**
1. Implement Toolbar component with zoom controls
2. Add keyboard shortcuts (zoom, scroll)
3. Add loading states and error handling
4. Implement text layer for selection/copying
5. Optimize rendering performance
6. Add fit-to-width calculation
7. Polish scrolling behavior

**Deliverables:**
- Polished UI with zoom toolbar
- Text selection support
- Smooth user experience
- Keyboard support

### Phase 3: Testing and Documentation

**Tasks:**
1. Write extension tests
2. Test with various PDF files (sizes, formats)
3. Test virtual scrolling with large PDFs (100+ pages)
4. Write user documentation
5. Create developer documentation (as reference implementation)
6. Add to extensions directory

**Deliverables:**
- Comprehensive tests
- Performance validation
- User and developer documentation
- Published extension

## Technical Considerations

### PDF.js Integration

**Worker Thread:**
PDF.js uses a web worker for PDF parsing. Need to:
- Configure worker path in Vite build
- Handle worker loading in Electron context
- Consider bundling worker or using CDN

**Memory Management:**
- Virtual scrolling handles memory efficiently
- Only renders visible pages + overscan (2 pages above/below)
- Automatic cleanup when pages scroll out of view
- Can handle 100+ page PDFs without memory issues

**Text Layer:**
- PDF.js can extract text layer for selection/copying
- Overlay transparent text layer on canvas
- Enables native browser text selection

### Performance Optimization

1. **Virtual Scrolling:**
  - Uses `@tanstack/react-virtual` (already in Nimbalyst)
  - Only renders visible pages + 2 overscan
  - Smooth scrolling with transform-based positioning
  - Handles thousands of pages efficiently

2. **Canvas Optimization:**
  - Render pages on-demand as they enter viewport
  - Cancel rendering for pages that scroll away quickly
  - Use proper cleanup in useEffect return
  - Debounce zoom operations

3. **File Loading:**
  - Stream large PDF files
  - Show progress indicator
  - Handle loading errors gracefully
  - Calculate page dimensions dynamically

### Theme Integration

Use CSS variables from Nimbalyst's theme system:

```css
.pdf-viewer-editor {
  background-color: var(--surface-secondary);
  color: var(--text-primary);
}

.pdf-toolbar {
  background-color: var(--surface-primary);
  border-bottom: 1px solid var(--border-primary);
}

.pdf-canvas-container {
  /* PDF pages typically have white background */
  /* Add subtle shadow in dark themes */
  box-shadow: 0 2px 8px var(--shadow-color);
}
```

### Error Handling

Handle common PDF errors:
- Encrypted/password-protected PDFs
- Corrupted PDF files
- Unsupported PDF features
- File read errors
- Memory exhaustion

Display user-friendly error messages and fallback options.

## Testing Strategy

### Unit Tests

- usePDFDocument hook
- Page navigation logic
- Zoom calculation logic

### Integration Tests

- PDF loading and rendering
- Theme switching
- Keyboard shortcuts
- AI tool execution

### E2E Tests (Playwright)

```typescript
test('should open and view PDF file', async () => {
  await createPDFFile(workspaceDir, 'test.pdf');
  await page.locator('.file-tree-name', { hasText: 'test.pdf' }).click();
  await expect(page.locator('.pdf-viewer-editor')).toBeVisible();
  await expect(page.locator('.pdf-scroll-container')).toBeVisible();
  await expect(page.locator('.pdf-page').first()).toBeVisible();
});

test('should scroll through multi-page PDF', async () => {
  await createMultiPagePDF(workspaceDir, 'multi.pdf', 10);
  await page.locator('.file-tree-name', { hasText: 'multi.pdf' }).click();

  // Only first few pages should be rendered initially
  const visiblePages = await page.locator('.pdf-page').count();
  expect(visiblePages).toBeLessThan(10); // Virtual scrolling

  // Scroll down
  await page.locator('.pdf-scroll-container').evaluate((el) => {
    el.scrollTop = el.scrollHeight / 2;
  });

  // Different pages should now be visible
  await page.waitForTimeout(200);
  const newVisiblePages = await page.locator('.pdf-page').count();
  expect(newVisiblePages).toBeGreaterThan(0);
});

test('should zoom PDF', async () => {
  await createPDFFile(workspaceDir, 'test.pdf');
  await page.locator('.file-tree-name', { hasText: 'test.pdf' }).click();
  await page.keyboard.press('Meta+Plus');
  await expect(page.locator('.zoom-level')).toContainText('125%');
});
```

### Manual Testing

- Test with various PDF files (small, large, multi-page, single-page)
- Test with complex PDFs (images, forms, annotations)
- Test virtual scrolling performance with large PDFs (100+ pages)
- Test in all themes (light/dark/crystal-dark)
- Test keyboard shortcuts (zoom)
- Test text selection and copying

## Success Criteria

1. **Functionality:**
  - Successfully renders PDF files in all standard formats
  - Smooth continuous scrolling through pages
  - Responsive zoom controls
  - Text selection and copying works
  - Keyboard shortcuts work correctly

2. **Performance:**
  - PDF loads in under 2 seconds for typical files
  - Smooth scrolling with no jank
  - Virtual scrolling only renders visible pages
  - No memory leaks over extended use
  - Handles 100+ page PDFs efficiently

3. **Integration:**
  - Seamless theme switching
  - File tree shows PDF icon
  - Read-only state clearly communicated
  - Uses existing Nimbalyst dependencies (@tanstack/react-virtual)

4. **User Experience:**
  - Natural reading experience (continuous scroll)
  - Intuitive zoom controls
  - Clear loading/error states
  - Professional appearance
  - Consistent with Nimbalyst design

5. **Code Quality:**
  - Well-documented code
  - Comprehensive tests
  - Follows extension system patterns
  - Serves as reference implementation

## Dependencies

### Host Dependencies (to add to Nimbalyst)

```json
{
  "pdfjs-dist": "^4.0.0"
}
```

Note: `@tanstack/react-virtual` is already a Nimbalyst dependency, so no need to add it.

Expose in `window.__nimbalyst_extensions`:
```typescript
window.__nimbalyst_extensions.pdfjs = await import('pdfjs-dist');
window.__nimbalyst_extensions['pdfjs-dist/build/pdf.worker'] = worker;
window.__nimbalyst_extensions['@tanstack/react-virtual'] = await import('@tanstack/react-virtual');
```

### Extension Dependencies

```json
{
  "devDependencies": {
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

All runtime dependencies are externals (provided by host):
- react
- react-dom
- pdfjs-dist
- @tanstack/react-virtual

## Documentation

### User Documentation

Create `docs/extensions/pdf-viewer.md`:
- How to use the PDF viewer
- Keyboard shortcuts reference
- Troubleshooting guide

### Developer Documentation

Create `docs/extensions/pdf-viewer-development.md`:
- Extension architecture
- PDF.js integration details
- How to extend/modify
- Reference for other viewer extensions

## Open Questions

1. **PDF Forms:** Should we support interactive PDF forms, or read-only display?
  - **Recommendation:** Read-only for MVP, forms in future version

2. **Print Support:** Should we implement print functionality?
  - **Recommendation:** Not for MVP, consider for future

3. **Text Selection:** Should users be able to select and copy text?
  - **Recommendation:** Yes, implement text layer for selection

4. **Annotations:** Should we display PDF annotations (comments, highlights)?
  - **Recommendation:** Display-only for MVP, editing in future

5. **File Size Limits:** Should we limit PDF file size?
  - **Recommendation:** Warn at 50MB, refuse at 200MB for performance

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Large PDFs cause memory issues | High | Implement page caching, memory limits, warnings |
| PDF.js bundle size | Medium | Use CDN worker, lazy load components |
| Complex PDFs render slowly | Medium | Show loading indicators, optimize rendering |
| Encrypted PDFs not supported | Low | Clear error message, suggest external viewer |
| Browser compatibility issues | Low | PDF.js is well-supported, test in Electron |

## Timeline Estimate

Not providing specific timeline estimates per instructions, but work can be broken into phases:

1. Phase 1: Core scrolling viewer (largest effort)
2. Phase 2: UI polish and text selection (medium effort)
3. Phase 3: Testing and docs (medium effort)

## Related Work

- DatamodelLM extension (reference implementation)
- Extension system documentation
- Custom editor API

## References

- [PDF.js Documentation](https://mozilla.github.io/pdf.js/)
- [nimbalyst-extension-system.md](./../../design/Extensions/nimbalyst-extension-system.md)
- [nimbalyst-extension-api.md](./../../design/Extensions/nimbalyst-extension-api.md)
- [DatamodelLM Extension](../../packages/extensions/datamodellm/)
