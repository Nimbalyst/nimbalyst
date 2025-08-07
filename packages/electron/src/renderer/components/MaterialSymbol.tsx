import React from 'react';

interface MaterialSymbolProps {
  icon: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  grade?: number;
  opticalSize?: number;
  className?: string;
}

export function MaterialSymbol({ 
  icon, 
  size = 20, 
  fill = false,
  weight = 400,
  grade = 0,
  opticalSize = 24,
  className = ''
}: MaterialSymbolProps) {
  const style = {
    fontSize: size,
    fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${opticalSize}`
  };

  return (
    <span className={`material-symbols-outlined ${className}`} style={style}>
      {icon}
    </span>
  );
}