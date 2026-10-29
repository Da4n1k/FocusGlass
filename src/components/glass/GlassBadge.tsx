import React from 'react';

interface GlassBadgeProps {
  children: React.ReactNode;
  variant?: 'green' | 'orange' | 'cyan' | 'violet' | 'red' | 'neutral';
  pulse?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

export const GlassBadge: React.FC<GlassBadgeProps> = ({
  children,
  variant = 'neutral',
  pulse = false,
  className = '',
  icon,
}) => {
  const variantStyles = {
    green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    violet: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    red: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    neutral: 'bg-white/10 text-slate-300 border-white/15',
  };

  const dotColors = {
    green: 'bg-emerald-400',
    orange: 'bg-orange-400',
    cyan: 'bg-cyan-400',
    violet: 'bg-purple-400',
    red: 'bg-rose-400',
    neutral: 'bg-slate-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md shadow-sm ${variantStyles[variant]} ${className}`}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColors[variant]}`}
          />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColors[variant]}`} />
        </span>
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  );
};
