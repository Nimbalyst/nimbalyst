/**
 * Print stylesheet for PDF export.
 *
 * This stylesheet contains all necessary styles for rendering Lexical editor
 * content as a PDF, with CSS variables resolved to concrete light-theme values.
 * UI-only elements (cursors, selection, resize handles) are hidden.
 */

/**
 * Complete CSS for PDF export with all variables resolved to light theme values.
 */
export const PRINT_STYLESHEET = `
/* Base document styles */
* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #111827;
  background: #ffffff;
  margin: 0;
  padding: 20px 40px;
}

/* Root container */
.pdf-export {
  max-width: 100%;
}

/* Text direction */
.PlaygroundEditorTheme__ltr {
  text-align: left;
}

.PlaygroundEditorTheme__rtl {
  text-align: right;
}

/* Paragraph */
.PlaygroundEditorTheme__paragraph {
  margin: 0 0 0.5em 0;
  position: relative;
}

/* Headings */
.PlaygroundEditorTheme__h1 {
  font-size: 28px;
  color: #050505;
  font-weight: 500;
  margin: 1em 0 0.5em 0;
}

.PlaygroundEditorTheme__h2 {
  font-size: 20px;
  color: #4d4c4c;
  font-weight: 600;
  margin: 1em 0 0.5em 0;
}

.PlaygroundEditorTheme__h3 {
  font-size: 16px;
  color: rgb(101, 103, 107);
  font-weight: 600;
  margin: 1em 0 0.5em 0;
}

.PlaygroundEditorTheme__h4 {
  font-size: 14px;
  color: rgb(101, 103, 107);
  font-weight: 600;
  margin: 1em 0 0.5em 0;
}

.PlaygroundEditorTheme__h5 {
  font-size: 12px;
  color: rgb(101, 103, 107);
  font-weight: 600;
  margin: 1em 0 0.5em 0;
}

.PlaygroundEditorTheme__h6 {
  font-size: 10px;
  color: rgb(101, 103, 107);
  font-weight: 600;
  margin: 1em 0 0.5em 0;
}

/* Text formatting */
.PlaygroundEditorTheme__textBold {
  font-weight: bold;
}

.PlaygroundEditorTheme__textItalic {
  font-style: italic;
}

.PlaygroundEditorTheme__textUnderline {
  text-decoration: underline;
}

.PlaygroundEditorTheme__textStrikethrough {
  text-decoration: line-through;
}

.PlaygroundEditorTheme__textUnderlineStrikethrough {
  text-decoration: underline line-through;
}

.PlaygroundEditorTheme__textSubscript {
  font-size: 0.8em;
  vertical-align: sub;
}

.PlaygroundEditorTheme__textSuperscript {
  font-size: 0.8em;
  vertical-align: super;
}

.PlaygroundEditorTheme__textHighlight {
  background: rgba(255, 212, 0, 0.14);
  border-bottom: 2px solid rgba(255, 212, 0, 0.3);
}

/* Inline code */
.PlaygroundEditorTheme__textCode {
  background-color: rgb(240, 242, 245);
  padding: 1px 0.25rem;
  font-family: Menlo, Consolas, Monaco, monospace;
  font-size: 94%;
  border-radius: 2px;
}

/* Links */
.PlaygroundEditorTheme__link {
  color: rgb(33, 111, 219);
  text-decoration: none;
}

/* Quote */
.PlaygroundEditorTheme__quote {
  margin: 0 0 10px 20px;
  font-size: 15px;
  color: rgb(101, 103, 107);
  border-left: 4px solid rgb(206, 208, 212);
  padding-left: 16px;
}

/* Hashtag */
.PlaygroundEditorTheme__hashtag {
  background-color: rgba(88, 144, 255, 0.15);
  border-radius: 4px;
  padding-left: 3px;
  padding-right: 3px;
  display: inline-block;
}

/* Code blocks */
.PlaygroundEditorTheme__code {
  background-color: rgb(240, 242, 245);
  font-family: Menlo, Consolas, Monaco, monospace;
  display: block;
  padding: 8px 8px 8px 52px;
  line-height: 1.53;
  font-size: 13px;
  margin: 8px 0;
  overflow-x: auto;
  position: relative;
  tab-size: 2;
  border-radius: 4px;
  page-break-inside: avoid;
}

.PlaygroundEditorTheme__code:before {
  content: attr(data-gutter);
  position: absolute;
  background-color: #eee;
  left: 0;
  top: 0;
  border-right: 1px solid #ccc;
  padding: 8px;
  color: #777;
  white-space: pre-wrap;
  text-align: right;
  min-width: 25px;
}

/* Code syntax highlighting */
.PlaygroundEditorTheme__tokenComment {
  color: slategray;
}

.PlaygroundEditorTheme__tokenPunctuation {
  color: #999;
}

.PlaygroundEditorTheme__tokenProperty {
  color: #905;
}

.PlaygroundEditorTheme__tokenSelector {
  color: #690;
}

.PlaygroundEditorTheme__tokenOperator {
  color: #9a6e3a;
}

.PlaygroundEditorTheme__tokenAttr {
  color: #07a;
}

.PlaygroundEditorTheme__tokenVariable {
  color: #e90;
}

.PlaygroundEditorTheme__tokenFunction {
  color: #dd4a68;
}

/* Lists */
.PlaygroundEditorTheme__ol1,
.PlaygroundEditorTheme__ol2,
.PlaygroundEditorTheme__ol3,
.PlaygroundEditorTheme__ol4,
.PlaygroundEditorTheme__ol5 {
  padding: 0;
  margin: 0;
  list-style-position: inside;
}

.PlaygroundEditorTheme__ol2 {
  list-style-type: upper-alpha;
}

.PlaygroundEditorTheme__ol3 {
  list-style-type: lower-alpha;
}

.PlaygroundEditorTheme__ol4 {
  list-style-type: upper-roman;
}

.PlaygroundEditorTheme__ol5 {
  list-style-type: lower-roman;
}

.PlaygroundEditorTheme__ul {
  padding: 0;
  margin: 0;
  list-style-position: inside;
}

.PlaygroundEditorTheme__listItem {
  margin: 0 24px;
}

.PlaygroundEditorTheme__nestedListItem {
  list-style-type: none;
}

/* Checkbox lists */
.PlaygroundEditorTheme__listItemChecked,
.PlaygroundEditorTheme__listItemUnchecked {
  position: relative;
  margin-left: 8px;
  margin-right: 8px;
  padding-left: 24px;
  padding-right: 24px;
  list-style-type: none;
}

.PlaygroundEditorTheme__listItemChecked {
  text-decoration: line-through;
}

.PlaygroundEditorTheme__listItemUnchecked:before,
.PlaygroundEditorTheme__listItemChecked:before {
  content: '';
  width: 16px;
  height: 16px;
  top: 2px;
  left: 0;
  display: block;
  position: absolute;
}

.PlaygroundEditorTheme__listItemUnchecked:before {
  border: 1px solid #999;
  border-radius: 2px;
}

.PlaygroundEditorTheme__listItemChecked:before {
  border: 1px solid rgb(61, 135, 245);
  border-radius: 2px;
  background-color: #3d87f5;
}

.PlaygroundEditorTheme__listItemChecked:after {
  content: '';
  border-color: #fff;
  border-style: solid;
  position: absolute;
  display: block;
  top: 6px;
  width: 3px;
  left: 7px;
  height: 6px;
  transform: rotate(45deg);
  border-width: 0 2px 2px 0;
}

/* Tables */
.PlaygroundEditorTheme__tableScrollableWrapper {
  overflow-x: visible;
  margin: 0 0 16px 0;
}

.PlaygroundEditorTheme__table {
  border-collapse: collapse;
  border-spacing: 0;
  table-layout: fixed;
  margin: 16px 0;
  page-break-inside: avoid;
}

.PlaygroundEditorTheme__tableCell {
  border: 1px solid #bbb;
  vertical-align: top;
  text-align: start;
  padding: 6px 8px;
  min-width: 50px;
}

.PlaygroundEditorTheme__tableCellHeader {
  background-color: #f2f3f5;
  text-align: start;
  font-weight: bold;
}

/* Hide table UI elements */
.PlaygroundEditorTheme__tableAddColumns,
.PlaygroundEditorTheme__tableAddRows,
.PlaygroundEditorTheme__tableCellResizer,
.PlaygroundEditorTheme__tableCellActionButtonContainer,
.PlaygroundEditorTheme__tableCellActionButton {
  display: none !important;
}

/* Horizontal rule */
.PlaygroundEditorTheme__hr {
  border: none;
  margin: 1em 0;
}

.PlaygroundEditorTheme__hr:after {
  content: '';
  display: block;
  height: 2px;
  background-color: #ccc;
}

/* Layout containers */
.PlaygroundEditorTheme__layoutContainer {
  display: grid;
  gap: 10px;
  margin: 10px 0;
}

.PlaygroundEditorTheme__layoutItem {
  border: 1px dashed #ddd;
  padding: 8px 16px;
  min-width: 0;
  max-width: 100%;
}

/* Images */
.editor-image {
  display: block;
  max-width: 100%;
  margin: 8px 0;
}

.editor-image img {
  max-width: 100%;
  height: auto;
}

.ImageNode__contentEditable {
  font-size: 12px;
  padding: 10px;
  color: #666;
  font-style: italic;
}

/* Hide image placeholder */
.ImageNode__placeholder {
  display: none;
}

/* Collapsible sections - show expanded in print */
.Collapsible__container {
  background: #fcfcfc;
  border: 1px solid #eee;
  border-radius: 10px;
  margin-bottom: 8px;
  page-break-inside: avoid;
}

.Collapsible__title {
  padding: 5px 5px 5px 20px;
  position: relative;
  font-weight: bold;
  list-style: none;
}

.Collapsible__title::marker,
.Collapsible__title::-webkit-details-marker {
  display: none;
}

.Collapsible__title:before {
  border-style: solid;
  border-color: transparent;
  border-width: 6px 4px 0 4px;
  border-top-color: #000;
  display: block;
  content: '';
  position: absolute;
  left: 7px;
  top: 50%;
  transform: translateY(-50%);
}

.Collapsible__content {
  padding: 0 5px 5px 20px;
}

/* Force show collapsed content in print */
.Collapsible__collapsed .Collapsible__content {
  display: block !important;
}

/* Mermaid diagrams */
.mermaid-container {
  margin: 16px 0;
  page-break-inside: avoid;
}

.mermaid-header {
  display: none;
}

/* Diff styling - show diffs but simplified for print */
.PlaygroundEditorTheme__diffAdd {
  background-color: #e6ffed;
  border-radius: 2px;
}

.PlaygroundEditorTheme__diffRemove {
  background-color: #ffebe9;
  text-decoration: line-through;
  border-radius: 2px;
}

/* Hide diff styling on empty paragraphs */
.PlaygroundEditorTheme__diffAdd:has(br:only-child),
.PlaygroundEditorTheme__diffRemove:has(br:only-child) {
  background-color: transparent;
}

/* Marks/highlights */
.PlaygroundEditorTheme__mark {
  background: rgba(255, 212, 0, 0.14);
  border-bottom: 2px solid rgba(255, 212, 0, 0.3);
  padding-bottom: 2px;
}

/* Hide UI-only elements */
.PlaygroundEditorTheme__blockCursor,
.PlaygroundEditorTheme__autocomplete,
.PlaygroundEditorTheme__tableCellSelected::after,
.PlaygroundEditorTheme__hrSelected {
  display: none !important;
}

/* Print-specific rules */
@media print {
  body {
    padding: 0;
  }

  .PlaygroundEditorTheme__code,
  .PlaygroundEditorTheme__table,
  .Collapsible__container {
    page-break-inside: avoid;
  }

  h1, h2, h3, h4, h5, h6 {
    page-break-after: avoid;
  }

  img {
    page-break-inside: avoid;
  }
}
`;

/**
 * Wraps HTML content with a full document structure including the print stylesheet.
 * @param content - The HTML content from $generateHtmlFromNodes
 * @returns Complete HTML document ready for PDF generation
 */
export function wrapWithPrintStyles(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${PRINT_STYLESHEET}</style>
</head>
<body class="pdf-export">
  <div class="PlaygroundEditorTheme__root">
    ${content}
  </div>
</body>
</html>`;
}
