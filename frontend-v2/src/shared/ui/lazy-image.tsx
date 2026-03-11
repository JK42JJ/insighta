import { useState, type ImgHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/utils';

interface LazyImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fallback?: string;
  srcSet?: string;
  sizes?: string;
}

const FALLBACK_SRC = '/placeholder.svg';

export function LazyImage({ className, fallback = FALLBACK_SRC, alt, srcSet, sizes, onError, ...props }: LazyImageProps) {
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
        srcSet={srcSet}
        sizes={sizes}
        className={cn(
          'w-full h-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          setError(true);
          setLoaded(true);
          const img = e.target as HTMLImageElement;
          img.srcset = '';
          img.src = fallback;
          onError?.(e);
        }}
      />
    </div>
  );
}
