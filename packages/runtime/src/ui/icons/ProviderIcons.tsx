import React from 'react';
import { MaterialSymbol } from './MaterialSymbol';

interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Convenience component for rendering provider icons.
 * Uses MaterialSymbol under the hood - just pass the provider name.
 */
export const ProviderIcon: React.FC<{ provider: string } & IconProps> = ({
  provider,
  size = 20,
  className = ''
}) => {
  return <MaterialSymbol icon={provider} size={size} className={className} />;
};

/**
 * Convenience function for getting a provider icon element.
 * Uses MaterialSymbol under the hood.
 */
export const getProviderIcon = (provider: string, props?: IconProps) => {
  return <MaterialSymbol icon={provider} size={props?.size} className={props?.className} />;
};
