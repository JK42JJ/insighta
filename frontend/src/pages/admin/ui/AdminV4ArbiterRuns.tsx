/**
 * CP489+ — v4 LLM-arbiter PoC runs dashboard (operator-only).
 *
 * Embeds the standalone HTML dashboard at /v4-arbiter-dashboard.html
 * (lives in frontend/public/, gitignored — operator manually replaces
 * when new PoC runs land). Future iteration converts the embedded HTML
 * into a React component with live DB-backed runs once PR #788 + v4
 * scenarios table is in place.
 *
 * Design: docs/design/v4-llm-arbiter-2026-05-29.md + handoff §11.6.
 */

import { ExternalLink } from 'lucide-react';

export function AdminV4ArbiterRuns() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">v4 LLM-arbiter — PoC runs</h1>
            <p className="text-sm text-muted-foreground">
              dashboard mockup · 측정 중립 · picked% baseline 실측 미완
            </p>
          </div>
          <a
            href="/v4-arbiter-dashboard.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />새 탭에서 열기
          </a>
        </div>
      </div>
      <iframe
        title="v4 LLM-arbiter dashboard"
        src="/v4-arbiter-dashboard.html"
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
