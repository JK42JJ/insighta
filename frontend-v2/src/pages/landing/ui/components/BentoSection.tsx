import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

export function BentoSection({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex w-full flex-col items-center justify-center">
      {/* Section header */}
      <div className="flex items-center justify-center gap-6 self-stretch px-4 py-8 sm:px-6 md:px-24 md:py-16">
        <div className="flex w-full max-w-4xl flex-col items-center justify-start gap-3 overflow-hidden">
          <Badge variant="outline">How It Works</Badge>
          <div className="flex w-full max-w-xl flex-col justify-center text-center text-xl leading-tight font-semibold tracking-tight sm:text-2xl md:text-3xl lg:text-4xl">
            From chaos to clarity
          </div>
          <div className="text-muted-foreground self-stretch text-center text-sm leading-6">
            The Mandala framework helps you organize insights
            <br className="hidden sm:block" />
            into a structured, multi-layered system of goals.
          </div>
        </div>
      </div>

      {/* Bento grid */}
      <div className="border-y p-4 w-full">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-border">
          {/* Hero card */}
          <div className="col-span-2 row-span-2 bg-background relative flex flex-col justify-between p-8">
            {/* Grid pattern background */}
            <div className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: 'radial-gradient(circle, hsl(var(--muted-foreground)) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />
            <div className="relative z-10">
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl lg:text-5xl">
                Crafted for
                <br />
                Deep Thinking.
              </h2>
              <p className="text-muted-foreground mt-4 max-w-md text-sm md:text-base">
                From fleeting ideas to structured knowledge — Insighta
                transforms how you capture, organize, and act on insights.
              </p>
            </div>
            <div className="relative z-10 flex gap-3 mt-6">
              <Button size="lg" onClick={onLogin}>Start Now</Button>
              <Button variant="outline" size="lg" onClick={onLogin}>
                Watch Demo
              </Button>
            </div>
          </div>

          {/* Small cards */}
          <BentoCard
            label="Capture"
            content={
              <div className="space-y-2 text-sm font-medium">
                <p>YouTube Videos</p>
                <p>Articles & Links</p>
                <p>File Uploads</p>
                <p>Manual Notes</p>
              </div>
            }
          />
          <BentoCard
            label="Process"
            content={
              <>
                <p className="text-sm font-medium">
                  Capture &rarr; Summarize &rarr; Categorize &rarr; Connect
                </p>
                <p className="text-muted-foreground text-xs mt-2">
                  AI-assisted workflow, human-directed goals.
                </p>
              </>
            }
          />
          <BentoCard
            label="Organize"
            colSpan={2}
            content={
              <>
                <h3 className="text-2xl font-semibold tracking-tight">
                  Mandala Grid System
                </h3>
                <p className="text-muted-foreground mt-2 text-sm">
                  9 cells, infinite depth. Nest your goals into hierarchical
                  levels that mirror how your mind naturally organizes ideas.
                </p>
              </>
            }
          />
          <BentoCard
            label="Reflect"
            content={
              <p className="text-sm italic">
                "Finally, a tool that thinks the way I do."
              </p>
            }
          />
          <BentoCard
            label="Stats"
            content={
              <div className="text-center">
                <h3 className="text-5xl font-bold tracking-tight">9x9</h3>
                <p className="text-muted-foreground text-sm mt-1">
                  Cells per Mandala
                </p>
              </div>
            }
            centered
          />
          <BentoCard
            label="Stack"
            colSpan={2}
            content={
              <>
                <p className="text-sm font-medium">
                  React &middot; Supabase &middot; AI Summaries &middot; dnd-kit
                </p>
                <p className="text-muted-foreground text-xs mt-2">
                  Built for speed, clarity, and seamless interaction.
                </p>
              </>
            }
          />
        </div>
      </div>

      {/* Hatch divider */}
      <div className="relative h-12 self-stretch overflow-hidden border-b">
        <div className="absolute inset-0 h-full w-full overflow-hidden">
          <div className="relative h-full w-full">
            {Array.from({ length: 300 }).map((_, i) => (
              <div
                key={i}
                className="outline-primary/40 absolute h-4 w-full origin-top-left -rotate-45 outline-[0.5px] outline-offset-[-0.25px]"
                style={{
                  top: `${i * 16 - 120}px`,
                  left: '-100%',
                  width: '300%',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BentoCard({
  label,
  content,
  colSpan,
  centered,
}: {
  label: string;
  content: React.ReactNode;
  colSpan?: number;
  centered?: boolean;
}) {
  return (
    <div
      className={`bg-background p-6 flex flex-col min-h-[180px] md:min-h-[220px] ${
        colSpan === 2 ? 'col-span-2' : ''
      } ${centered ? 'items-center justify-center' : 'justify-between'}`}
    >
      {!centered && (
        <span className="text-muted-foreground text-sm">{label}</span>
      )}
      <div>{content}</div>
    </div>
  );
}
