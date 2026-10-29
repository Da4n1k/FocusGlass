import React from 'react';

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'cyan' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export const GlassButton: React.FC<GlassButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
    md: 'px-4 py-2 text-sm gap-2 rounded-xl',
    lg: 'px-6 py-3 text-base gap-2.5 rounded-2xl font-medium',
  };

  const variantClasses = {
    primary:
      'bg-gradient-to-r from-[#FF6600] to-[#E64A00] text-white border border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_20px_-4px_rgba(255,102,0,0.4)] hover:brightness-110 active:scale-[0.98]',
    cyan:
      'bg-gradient-to-r from-[#00D2FF]/80 to-[#00A3C4]/90 text-slate-950 font-semibold border border-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_20px_-4px_rgba(0,210,255,0.4)] hover:brightness-110 active:scale-[0.98]',
    secondary:
      'bg-white/10 hover:bg-white/15 text-slate-200 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:border-white/30 active:scale-[0.98]',
    ghost:
      'bg-transparent hover:bg-white/10 text-slate-300 hover:text-white border border-transparent hover:border-white/10 active:scale-[0.98]',
    danger:
      'bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 shadow-[0_4px_16px_rgba(239,68,68,0.25)] active:scale-[0.98]',
  };

  return (
    <button
      className={`relative inline-flex items-center justify-center transition-all duration-200 backdrop-blur-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};
