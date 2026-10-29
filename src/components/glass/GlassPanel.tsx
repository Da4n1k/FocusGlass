import React from 'react';

interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'card' | 'subtle';
  glow?: 'none' | 'orange' | 'cyan' | 'violet' | 'green';
  hasSpecular?: boolean;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className = '',
  variant = 'primary',
  glow = 'none',
  hasSpecular = true,
  ...props
}) => {
  const baseClass = variant === 'card' ? 'liquid-glass-card' : 'liquid-glass';
  const glowClass =
    glow === 'orange'
      ? 'glow-orange'
      : glow === 'cyan'
      ? 'glow-cyan'
      : glow === 'violet'
      ? 'glow-violet'
      : glow === 'green'
      ? 'glow-green'
      : '';
  const specularClass = hasSpecular ? 'liquid-glass-bevel' : '';

  return (
    <div
      className={`rounded-2xl transition-all duration-300 ${baseClass} ${glowClass} ${specularClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
