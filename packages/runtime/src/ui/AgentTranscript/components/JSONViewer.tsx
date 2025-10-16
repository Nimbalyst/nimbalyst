import React from 'react';
import './JSONViewer.css';

interface JSONViewerProps {
  data: any;
  maxHeight?: string;
}

export const JSONViewer: React.FC<JSONViewerProps> = ({ data, maxHeight = '16rem' }) => {
  const formatJSON = (obj: any): JSX.Element => {
    let keyCounter = 0;
    const getUniqueKey = (prefix: string) => `${prefix}-${keyCounter++}`;

    const renderValue = (value: any, indent: number = 0): JSX.Element[] => {
      const indentStr = '  '.repeat(indent);
      const elements: JSX.Element[] = [];

      if (value === null) {
        elements.push(<span key={getUniqueKey('null')} className="json-null">null</span>);
      } else if (typeof value === 'boolean') {
        elements.push(<span key={getUniqueKey('bool')} className="json-boolean">{String(value)}</span>);
      } else if (typeof value === 'number') {
        elements.push(<span key={getUniqueKey('num')} className="json-number">{value}</span>);
      } else if (typeof value === 'string') {
        elements.push(<span key={getUniqueKey('str')} className="json-string">"{value}"</span>);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          elements.push(<span key={getUniqueKey('arr')}>[]</span>);
        } else {
          elements.push(<span key={getUniqueKey('arr-open')} className="json-bracket">[</span>);
          elements.push(<br key={getUniqueKey('br')} />);
          value.forEach((item, idx) => {
            elements.push(<span key={getUniqueKey('indent')}>{indentStr}  </span>);
            elements.push(...renderValue(item, indent + 1));
            if (idx < value.length - 1) {
              elements.push(<span key={getUniqueKey('comma')} className="json-punctuation">,</span>);
            }
            elements.push(<br key={getUniqueKey('br')} />);
          });
          elements.push(<span key={getUniqueKey('indent')}>{indentStr}</span>);
          elements.push(<span key={getUniqueKey('arr-close')} className="json-bracket">]</span>);
        }
      } else if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) {
          elements.push(<span key={getUniqueKey('obj')}>{'{}'}</span>);
        } else {
          elements.push(<span key={getUniqueKey('obj-open')} className="json-bracket">{'{'}</span>);
          elements.push(<br key={getUniqueKey('br')} />);
          keys.forEach((key, idx) => {
            elements.push(<span key={getUniqueKey('indent')}>{indentStr}  </span>);
            elements.push(<span key={getUniqueKey('key')} className="json-key">"{key}"</span>);
            elements.push(<span key={getUniqueKey('colon')} className="json-punctuation">: </span>);
            elements.push(...renderValue(value[key], indent + 1));
            if (idx < keys.length - 1) {
              elements.push(<span key={getUniqueKey('comma')} className="json-punctuation">,</span>);
            }
            elements.push(<br key={getUniqueKey('br')} />);
          });
          elements.push(<span key={getUniqueKey('indent')}>{indentStr}</span>);
          elements.push(<span key={getUniqueKey('obj-close')} className="json-bracket">{'}'}</span>);
        }
      }

      return elements;
    };

    return <>{renderValue(obj)}</>;
  };

  return (
    <pre
      className="json-viewer"
      style={{ maxHeight, overflowY: 'auto' }}
    >
      {formatJSON(data)}
    </pre>
  );
};
