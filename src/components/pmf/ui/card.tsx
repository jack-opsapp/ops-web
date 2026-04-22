import { cn } from '@/lib/utils/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  dense?: boolean;
}

export function PmfCard({ dense, className, children, ...rest }: CardProps) {
  return (
    <div className={cn(dense ? 'glass-dense' : 'glass-surface', 'p-6', className)} {...rest}>
      {children}
    </div>
  );
}
