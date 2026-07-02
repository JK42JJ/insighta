/**
 * OnboardingChecklist — header chip "시작 가이드 N/5" + popover task list.
 *
 * Visible until every first-run task has been performed once, then gone
 * (James 2026-07-02: "모든 절차를 1번 이상 수행한 경우 사라지면 되고").
 * Clicking a row navigates to the right screen and fires a single coachmark
 * bubble; actual completion is detected from real actions, never the click.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, GraduationCap, Lock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { cn } from '@/shared/lib/utils';
import { ALL_TASKS, useOnboardingStore } from '../model/onboardingStore';
import { requestCoachmark } from '../model/coach-controller';
import { LEARNING_FALLBACK_STEP, TASK_GUIDES } from '../steps';

export function OnboardingChecklist() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const tasks = useOnboardingStore((s) => s.tasks);
  const grandfathered = useOnboardingStore((s) => s.grandfathered);
  const [open, setOpen] = useState(false);

  const doneCount = ALL_TASKS.filter((task) => tasks.includes(task)).length;
  // Hidden until grandfathering resolved (avoids a flash for existing users)
  // and gone forever once every step has been walked.
  if (!grandfathered || doneCount >= ALL_TASKS.length) return null;

  const onLearning = location.pathname.startsWith('/learning/');

  const handleRowClick = (task: (typeof TASK_GUIDES)[number]) => {
    setOpen(false);
    // Learning-only anchors (summary/note) can't be navigated to directly
    // (route needs a videoId) — guide toward opening a card instead.
    if (task.route === null && !onLearning) {
      if (location.pathname !== '/') navigate('/');
      requestCoachmark(LEARNING_FALLBACK_STEP);
      return;
    }
    if (task.route && location.pathname !== task.route) navigate(task.route);
    requestCoachmark(task.step);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-onboarding="guide-chip"
              aria-label={t('onboarding.chip', '시작 가이드')}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 text-[12px] font-medium text-primary hover:bg-primary/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <GraduationCap className="h-4 w-4" strokeWidth={2.2} />
              <span className="opacity-75">
                {doneCount}/{ALL_TASKS.length}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[12px]">
          {t('onboarding.chip', '시작 가이드')}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[300px] p-2 rounded-xl border-border/50"
      >
        <p className="px-2 pt-1 pb-2 text-[11.5px] text-muted-foreground">
          {t('onboarding.chipHint', '한 번씩 해보면 가이드가 자동으로 사라져요.')}
        </p>
        <ul className="flex flex-col">
          {/* SEQUENTIAL steps (James: 라디오 아님, 넘버로 — 만다라 생성이
              선행돼야 이후 진행). Numbered 1..5; a row is clickable only
              when every previous step is done; later rows stay locked. */}
          {TASK_GUIDES.map((guide, idx) => {
            const done = tasks.includes(guide.task);
            const locked = !done && TASK_GUIDES.slice(0, idx).some((g) => !tasks.includes(g.task));
            return (
              <li key={guide.task}>
                <button
                  type="button"
                  disabled={done || locked}
                  onClick={() => handleRowClick(guide)}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors',
                    done && 'text-muted-foreground/60 cursor-default',
                    locked && 'text-muted-foreground/40 cursor-default',
                    !done && !locked && 'text-foreground hover:bg-foreground/[0.05]'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10.5px] font-semibold',
                      done && 'border-primary bg-primary text-primary-foreground',
                      locked && 'border-border/40 text-muted-foreground/40',
                      !done && !locked && 'border-primary/60 text-primary'
                    )}
                  >
                    {done ? <Check className="h-3 w-3" strokeWidth={3} /> : idx + 1}
                  </span>
                  <span className={cn(done && 'line-through')}>
                    {t(guide.labelKey, guide.labelDefault)}
                  </span>
                  {locked && <Lock className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/40" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
