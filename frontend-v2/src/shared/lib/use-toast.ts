/**
 * Toast adapter — bridges shadcn useToast() API to Sonner.
 *
 * All existing callers use `useToast()` or `toast()` with
 * `{ title, description, variant }`. This module delegates
 * to Sonner so a single Toaster (<Sonner />) in App.tsx is enough.
 */
import { toast as sonnerToast } from 'sonner';

interface ToastProps {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

function toast({ title, description, variant }: ToastProps) {
  if (variant === 'destructive') {
    sonnerToast.error(title, { description });
  } else {
    sonnerToast.success(title, { description });
  }
}

function useToast() {
  return { toast };
}

export { useToast, toast };
