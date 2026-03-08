import { Button } from '@/shared/ui/button';

export function HeroSection({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="relative pt-40 pb-16">
      <div className="mx-auto max-w-4xl px-4">
        <div className="flex flex-col items-center gap-12">
          <div className="flex flex-col items-center gap-6">
            <h1 className="max-w-4xl text-center text-5xl leading-tight font-medium md:text-7xl">
              Organize insights
              <br />
              that shape your goals
            </h1>
            <p className="text-muted-foreground max-w-xl text-center text-lg leading-7 font-medium">
              Capture, categorize, and connect your ideas with the
              Mandala framework. Turn scattered thoughts into structured action.
            </p>
          </div>

          <div className="flex justify-center gap-3">
            <Button size="lg" onClick={onLogin}>
              Get Started Free
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
