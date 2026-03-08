import { useState, type ImgHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/utils';

interface LazyImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fallback?: string;
}

const FALLBACK_SRC = 'https://via.placeholder.com/320x180?text=Thumbnail';

export function LazyImage({ className, fallback = FALLBACK_SRC, alt, onError, ...props }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* LQIP blur placeholder */}
      {!loaded && !error && (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      )}
      <img
        {...props}
        alt={alt}
        loading="lazy"
        className={cn(
          'w-full h-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          setError(true);
          setLoaded(true);
          (e.target as HTMLImageElement).src = fallback;
          onError?.(e);
        }}
      />
    </div>
  );
}
