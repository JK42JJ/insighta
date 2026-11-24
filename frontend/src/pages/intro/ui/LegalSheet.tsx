import { lazy, Suspense, useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';

import { CLOSE_LABEL } from '../model/intro-content';

/*
 * Footer link -> the existing privacy policy or terms page content in a floating panel over the
 * landing (James 2026-11-24): no navigation. Radix Dialog gives the focus trap, Esc, the return
 * of focus to the link and the background scroll lock.
 */

const PrivacyPage = lazy(() => import('@/pages/privacy'));
const TermsPage = lazy(() => import('@/pages/terms'));

export type LegalDoc = 'privacy' | 'terms';

export interface LegalSheetProps {
  doc: LegalDoc;
  /** The footer text; also the panel's accessible title. */
  label: string;
  /** The footer link itself (rendered as the trigger). */
  children: ReactNode;
}

export function LegalSheet({ doc, label, children }: LegalSheetProps): JSX.Element {
  const body = useRef<HTMLDivElement>(null);
  const toTop = (): void => body.current?.scrollTo({ top: 0, behavior: 'smooth' });
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid={`li-sheet-${doc}`}
          className="fixed inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),24px)] z-[1100] mx-auto flex w-full max-w-[430px] flex-col overflow-hidden rounded-t-2xl bg-background text-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom motion-reduce:animate-none"
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <DialogPrimitive.Close
            aria-label={CLOSE_LABEL}
            data-testid="li-sheet-close"
            className="absolute right-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogPrimitive.Close>
          <div
            ref={body}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
          >
            <Suspense fallback={null}>
              {doc === 'privacy' ? (
                <PrivacyPage onBackToTop={toTop} />
              ) : (
                <TermsPage onBackToTop={toTop} />
              )}
            </Suspense>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
