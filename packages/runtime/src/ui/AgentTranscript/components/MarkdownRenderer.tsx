import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import './MarkdownRenderer.css';

// Wrapper for any element that might overflow horizontally
const OverflowWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wordWrap, setWordWrap] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkOverflow = () => {
      if (contentRef.current) {
        const el = contentRef.current;
        setIsOverflowing(el.scrollWidth > el.clientWidth + 1);
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [children]);

  return (
    <div className={`overflow-wrapper ${wordWrap ? 'word-wrap-enabled' : ''}`}>
      <div ref={contentRef} className="overflow-content">
        {children}
      </div>
      {(isOverflowing || wordWrap) && (
        <label className="wrap-toggle">
          <input
            type="checkbox"
            checked={wordWrap}
            onChange={(e) => setWordWrap(e.target.checked)}
          />
          <span>Wrap</span>
        </label>
      )}
    </div>
  );
};

interface MarkdownRendererProps {
  content: string;
  isUser?: boolean;
  isSystemMessage?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  isUser = false,
  isSystemMessage = false
}) => {
  return (
    <div
      className="markdown-content"
      style={{
        fontWeight: isUser ? 500 : 400,
        color: 'var(--text-primary)',
        ...(isSystemMessage && {
          opacity: 0.85,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.95em'
        })
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks with syntax highlighting
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');
            const isSingleLine = !codeString.includes('\n');

            // True inline code (backticks in text)
            if (inline) {
              return (
                <code
                  className={className}
                  style={{
                    backgroundColor: 'var(--surface-tertiary)',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.875em',
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--text-primary)'
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            const codeStyle: React.CSSProperties = {
              backgroundColor: 'var(--surface-tertiary)',
              padding: isSingleLine ? '0.25rem 0.5rem' : '0.75rem',
              borderRadius: isSingleLine ? '0.25rem' : '0.375rem',
              fontSize: '0.8125rem',
              lineHeight: isSingleLine ? '1.4' : '1.5',
              margin: isSingleLine ? 0 : '0.5rem 0'
            };

            // Code block with language - use syntax highlighting
            if (language) {
              return (
                <OverflowWrapper>
                  <SyntaxHighlighter
                    style={{} as any}
                    customStyle={codeStyle}
                    language={language}
                    PreTag="div"
                    codeTagProps={{
                      style: {
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 'inherit',
                        background: 'none'
                      }
                    }}
                    {...props}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </OverflowWrapper>
              );
            }

            // Code block without language
            return (
              <OverflowWrapper>
                <code
                  className={className}
                  style={{
                    display: 'block',
                    ...codeStyle,
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--text-primary)'
                  }}
                  {...props}
                >
                  {children}
                </code>
              </OverflowWrapper>
            );
          },
          // Remove default pre wrapper - we handle styling in code component
          pre: ({ children }) => <>{children}</>,
          // Headings
          h1: ({ children }) => (
            <h1 style={{
              fontSize: '1.875rem',
              fontWeight: 700,
              marginTop: '1.5rem',
              marginBottom: '1rem',
              color: 'var(--text-primary)',
              borderBottom: '1px solid var(--border-primary)',
              paddingBottom: '0.5rem'
            }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              marginTop: '1.25rem',
              marginBottom: '0.75rem',
              color: 'var(--text-primary)'
            }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              marginTop: '1rem',
              marginBottom: '0.5rem',
              color: 'var(--text-primary)'
            }}>
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 style={{
              fontSize: '1.125rem',
              fontWeight: 600,
              marginTop: '1rem',
              marginBottom: '0.5rem',
              color: 'var(--text-primary)'
            }}>
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 style={{
              fontSize: '1rem',
              fontWeight: 600,
              marginTop: '0.75rem',
              marginBottom: '0.5rem',
              color: 'var(--text-primary)'
            }}>
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              marginTop: '0.75rem',
              marginBottom: '0.5rem',
              color: 'var(--text-primary)'
            }}>
              {children}
            </h6>
          ),
          // Paragraphs
          p: ({ children }) => (
            <p style={{
              marginTop: '0.5rem',
              marginBottom: '0.5rem',
              lineHeight: '1.625',
              color: 'var(--text-primary)',
              ...(isUser && { whiteSpace: 'pre-wrap' })
            }}>
              {children}
            </p>
          ),
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--accent-primary)',
                textDecoration: 'underline',
                cursor: 'pointer'
              }}
            >
              {children}
            </a>
          ),
          // Lists
          ul: ({ children }) => (
            <ul style={{
              marginTop: '0.5rem',
              marginBottom: '0.5rem',
              paddingLeft: '1.5rem',
              listStyleType: 'disc',
              color: 'var(--text-primary)'
            }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol style={{
              marginTop: '0.5rem',
              marginBottom: '0.5rem',
              paddingLeft: '1.5rem',
              listStyleType: 'decimal',
              color: 'var(--text-primary)'
            }}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{
              marginTop: '0.25rem',
              marginBottom: '0.25rem',
              lineHeight: '1.625'
            }}>
              {children}
            </li>
          ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '4px solid var(--border-primary)',
              paddingLeft: '1rem',
              marginLeft: '0',
              marginTop: '0.75rem',
              marginBottom: '0.75rem',
              color: 'var(--text-secondary)',
              fontStyle: 'italic'
            }}>
              {children}
            </blockquote>
          ),
          // Tables
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', marginTop: '0.75rem', marginBottom: '0.75rem' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.875rem',
                border: '1px solid var(--border-primary)'
              }}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{
              backgroundColor: 'var(--surface-secondary)',
              borderBottom: '2px solid var(--border-primary)'
            }}>
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody>
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr style={{
              borderBottom: '1px solid var(--border-primary)'
            }}>
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th style={{
              padding: '0.75rem',
              textAlign: 'left',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td style={{
              padding: '0.75rem',
              color: 'var(--text-primary)'
            }}>
              {children}
            </td>
          ),
          // Horizontal rule
          hr: () => (
            <hr style={{
              border: 'none',
              borderTop: '1px solid var(--border-primary)',
              marginTop: '1rem',
              marginBottom: '1rem'
            }} />
          ),
          // Strong/Bold
          strong: ({ children }) => (
            <strong style={{
              fontWeight: 700,
              color: 'var(--text-primary)'
            }}>
              {children}
            </strong>
          ),
          // Emphasis/Italic
          em: ({ children }) => (
            <em style={{
              fontStyle: 'italic',
              color: 'var(--text-primary)'
            }}>
              {children}
            </em>
          ),
          // Strikethrough (GFM)
          del: ({ children }) => (
            <del style={{
              textDecoration: 'line-through',
              color: 'var(--text-tertiary)'
            }}>
              {children}
            </del>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
