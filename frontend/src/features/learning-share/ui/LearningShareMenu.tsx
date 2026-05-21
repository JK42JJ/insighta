/**
 * Learning page share menu (CP454 handoff).
 *
 * Popover trigger button placed next to the HighlightReel ⚡ button in the
 * CenterPanel tab row. Click → reveals:
 *   - Top: OG preview card (thumbnail + title + AI summary first sentence)
 *   - Bottom: 2-section channel list
 *       빠른 공유: 링크 복사 / 카카오톡
 *       더보기:    X / 네이버
 *
 * Channels (4):
 *   - 링크 복사   navigator.clipboard.writeText + sonner toast
 *   - 카카오톡    Kakao JS SDK Feed message — disabled until VITE_KAKAO_JS_KEY
 *                 secret is set (Phase 3, see docs/guides/kakao-share-setup.md)
 *   - X          Web Intent — no SDK
 *   - 네이버      Simple share-view URL — no SDK
 *
 * OG: share URLs ALL point to the BE OG endpoint (Phase 5,
 * `GET /og/learning/:m/:v`) so SNS crawlers can resolve the meta card.
 * The BE responds with og:* + redirect → SPA learning page.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link as LinkIcon, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { cn } from '@/shared/lib/utils';
import {
  buildShareUrl,
  openNaverShare,
  openXShare,
  youtubeThumbnailUrl,
} from '../lib/build-share-urls';

const KAKAO_JS_KEY: string | undefined = import.meta.env.VITE_KAKAO_JS_KEY as string | undefined;

declare global {
  interface Window {
    Kakao?: {
      isInitialized: () => boolean;
      init: (key: string) => void;
      Share: {
        sendDefault: (payload: unknown) => void;
      };
    };
  }
}

function ensureKakaoInit(): boolean {
  if (!KAKAO_JS_KEY || !window.Kakao) return false;
  if (!window.Kakao.isInitialized()) {
    try {
      window.Kakao.init(KAKAO_JS_KEY);
    } catch {
      return false;
    }
  }
  return window.Kakao.isInitialized();
}

export interface LearningShareMenuProps {
  /** UUID — used in BE OG endpoint path. */
  mandalaId: string;
  /** YouTube video id (11-char). */
  videoId: string;
  /** Video title — falls back to a generic share text key when null. */
  title: string | null | undefined;
  /** AI summary first sentence — fed into OG preview and Kakao description. */
  oneLiner: string | null | undefined;
}

/**
 * Brand SVGs follow each platform's official mark color/shape rule (Kakao
 * yellow + bubble, X black logo, Naver green N). Project-mono line SVGs are
 * the exception for non-brand glyphs (Share2 trigger, Copy/LinkIcon).
 */
const BrandXIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const BrandKakaoIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M12 3C6.48 3 2 6.62 2 11.08c0 2.82 1.83 5.3 4.6 6.74-.2.74-.74 2.7-.85 3.12-.13.52.19.51.4.37.16-.11 2.55-1.73 3.58-2.43.74.1 1.5.16 2.27.16 5.52 0 10-3.62 10-8.08C22 6.62 17.52 3 12 3z" />
  </svg>
);

const BrandNaverIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M14.45 12.79L9.42 4.5H4.5v15h5.05v-8.29l5.03 8.29h4.92V4.5h-5.05v8.29z" />
  </svg>
);

export function LearningShareMenu({ mandalaId, videoId, title, oneLiner }: LearningShareMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const effectiveTitle = title || t('cards.defaultShareText');
  const effectiveDescription = oneLiner ?? '';
  const thumbnail = youtubeThumbnailUrl(videoId);
  const shareUrl = buildShareUrl({ origin: window.location.origin, mandalaId, videoId });

  const close = useCallback(() => setOpen(false), []);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(t('learningShare.linkCopied'));
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('learningShare.linkCopyFailed'));
    }
  }, [shareUrl, t]);

  const handleKakao = useCallback(() => {
    if (!ensureKakaoInit()) {
      toast.error(t('learningShare.kakaoNotConfigured'));
      return;
    }
    try {
      window.Kakao!.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: effectiveTitle,
          description: effectiveDescription,
          imageUrl: thumbnail,
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        },
        buttons: [
          {
            title: t('learningShare.kakaoButtonViewLink'),
            link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
          },
        ],
      });
      close();
    } catch {
      toast.error(t('learningShare.kakaoSendFailed'));
    }
  }, [effectiveTitle, effectiveDescription, thumbnail, shareUrl, t, close]);

  const handleX = useCallback(() => {
    openXShare({ title: effectiveTitle, url: shareUrl });
    toast.success(t('videoPlayer.xShareOpened'));
    close();
  }, [effectiveTitle, shareUrl, t, close]);

  const handleNaver = useCallback(() => {
    openNaverShare({ title: effectiveTitle, url: shareUrl });
    close();
  }, [effectiveTitle, shareUrl, close]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('learningShare.button')}
              className={cn(
                'inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                'text-white hover:bg-white/10'
              )}
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[12px]">
          {t('learningShare.button')}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[300px] p-0 overflow-hidden border-border/60"
      >
        {/* OG preview */}
        <div className="px-3.5 pt-3 pb-2.5">
          <p className="text-[10.5px] font-medium tracking-wider text-muted-foreground/80 uppercase mb-2">
            {t('learningShare.preview')}
          </p>
          <div className="flex gap-2.5 rounded-lg border border-border/50 bg-foreground/[0.02] p-2">
            <div
              className="h-11 w-16 shrink-0 rounded-md bg-cover bg-center"
              style={{ backgroundImage: `url(${thumbnail})` }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[11.5px] font-medium text-foreground truncate">{effectiveTitle}</p>
              {effectiveDescription && (
                <p className="text-[10px] text-muted-foreground line-clamp-2 leading-snug mt-0.5">
                  {effectiveDescription}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="h-px bg-border/60" />

        {/* Channels */}
        <div className="py-1.5 px-1.5">
          <p className="text-[10px] font-medium text-muted-foreground/70 mx-2 my-1">
            {t('learningShare.quickShare')}
          </p>

          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-foreground/[0.04] transition-colors"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-foreground/[0.06] text-foreground/80">
              {copied ? <Check className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
            </span>
            <span className="text-[12.5px] text-foreground">
              {copied ? t('learningShare.linkCopied') : t('learningShare.copyLink')}
            </span>
            {!copied && <Copy className="h-3 w-3 ml-auto text-muted-foreground/60" />}
          </button>

          <button
            type="button"
            onClick={handleX}
            className="w-full flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-foreground/[0.04] transition-colors"
          >
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: '#000', color: '#fff' }}
            >
              <BrandXIcon />
            </span>
            <span className="text-[12.5px] text-foreground">{t('learningShare.x')}</span>
          </button>

          <button
            type="button"
            onClick={handleNaver}
            className="w-full flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-foreground/[0.04] transition-colors"
          >
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: '#03C75A', color: '#fff' }}
            >
              <BrandNaverIcon />
            </span>
            <span className="text-[12.5px] text-foreground">{t('learningShare.naver')}</span>
          </button>

          <button
            type="button"
            onClick={handleKakao}
            disabled={!KAKAO_JS_KEY}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors',
              KAKAO_JS_KEY ? 'hover:bg-foreground/[0.04]' : 'opacity-50 cursor-not-allowed'
            )}
            title={!KAKAO_JS_KEY ? t('learningShare.kakaoNotConfigured') : undefined}
          >
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: '#FEE500', color: '#191919' }}
            >
              <BrandKakaoIcon />
            </span>
            <span className="text-[12.5px] text-foreground">{t('learningShare.kakao')}</span>
            {!KAKAO_JS_KEY && (
              <span className="ml-auto text-[10px] text-muted-foreground/70">
                {t('learningShare.comingSoon')}
              </span>
            )}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
