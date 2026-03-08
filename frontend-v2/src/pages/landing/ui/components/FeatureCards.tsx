import { useEffect, useRef, useState } from 'react';
import { Grid3X3, Layers, Brain } from 'lucide-react';

const features = [
  {
    icon: Grid3X3,
    title: 'Mandala Grid System',
    description:
      'Structure your goals into a 3x3 matrix. Each cell becomes a focus area, each level a deeper layer of intent.',
  },
  {
    icon: Layers,
    title: 'Drag & Drop Cards',
    description:
      'Capture insights from any source — YouTube, articles, files. Drag them into your mandala and watch patterns emerge.',
  },
  {
    icon: Brain,
    title: 'AI-Powered Summaries',
    description:
      'Let AI extract key takeaways, generate summaries, and connect dots across your knowledge base automatically.',
  },
];

export function FeatureCards() {
  const [activeCard, setActiveCard] = useState(0);
  const [progress, setProgress] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      setProgress((prev) => {
        if (prev >= 100) {
          if (mountedRef.current) {
            setActiveCard((current) => (current + 1) % 3);
          }
          return 0;
        }
        return prev + 2;
      });
    }, 100);

    return () => {
      clearInterval(interval);
      mountedRef.current = false;
    };
  }, []);

  const handleCardClick = (index: number) => {
    if (!mountedRef.current) return;
    setActiveCard(index);
    setProgress(0);
  };

  return (
    <div className="w-full">
      {/* Feature showcase area */}
      <div className="relative z-5 my-8 flex w-full flex-col items-center justify-center gap-2">
        <div className="flex h-[400px] md:h-[520px] w-full max-w-5xl flex-col items-start justify-start overflow-hidden rounded-md border shadow-2xl">
          <div className="flex flex-1 items-center justify-center w-full">
            <div className="relative h-full w-full overflow-hidden">
              {features.map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={i}
                    className={`absolute inset-0 flex flex-col items-center justify-center gap-6 px-8 transition-all duration-500 ease-in-out ${
                      activeCard === i
                        ? 'blur-0 scale-100 opacity-100'
                        : 'scale-95 opacity-0 blur-sm'
                    }`}
                    style={{
                      background:
                        'radial-gradient(ellipse at 50% 50%, hsl(var(--primary) / 0.08) 0%, hsl(var(--background)) 70%)',
                    }}
                  >
                    <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <Icon className="w-10 h-10 text-primary" />
                    </div>
                    <h3 className="text-3xl md:text-4xl font-semibold text-center tracking-tight">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground text-center text-lg max-w-lg">
                      {feature.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Feature tabs */}
      <div className="flex items-start justify-center self-stretch border-y">
        <HatchPattern />
        <div className="flex flex-1 flex-col items-stretch justify-center gap-0 md:flex-row">
          {features.map((feature, i) => (
            <FeatureTab
              key={i}
              title={feature.title}
              description={feature.description}
              isActive={activeCard === i}
              progress={activeCard === i ? progress : 0}
              onClick={() => handleCardClick(i)}
            />
          ))}
        </div>
        <HatchPattern />
      </div>
    </div>
  );
}

function FeatureTab({
  title,
  description,
  isActive,
  progress,
  onClick,
}: {
  title: string;
  description: string;
  isActive: boolean;
  progress: number;
  onClick: () => void;
}) {
  return (
    <div
      className={`relative flex w-full cursor-pointer flex-col items-start justify-start gap-2 self-stretch overflow-hidden px-6 py-5 md:flex-1 ${
        isActive ? 'bg-muted/50 border' : 'border-r-0 border-l-0 md:border'
      }`}
      onClick={onClick}
    >
      {isActive && (
        <div className="absolute top-0 left-0 h-1 w-full">
          <div
            className="bg-primary h-full transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <div className="flex flex-col justify-center self-stretch text-sm font-semibold md:text-lg">
        {title}
      </div>
      <div className="text-muted-foreground self-stretch text-sm">
        {description}
      </div>
    </div>
  );
}

function HatchPattern() {
  return (
    <div className="relative w-4 self-stretch overflow-hidden sm:w-6 md:w-8 lg:w-12">
      <div className="absolute -top-30 -left-4 flex w-40 flex-col items-start justify-start">
        {Array.from({ length: 50 }).map((_, i) => (
          <div
            key={i}
            className="outline-primary/40 h-4 origin-top-left -rotate-45 self-stretch outline-[0.5px] outline-offset-[-0.25px]"
          />
        ))}
      </div>
    </div>
  );
}
