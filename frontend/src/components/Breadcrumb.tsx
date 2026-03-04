import { ChevronRight, Home } from "lucide-react";
import { MandalaPath } from "@/types/mandala";
import { cn } from "@/lib/utils";

interface BreadcrumbProps {
  path: MandalaPath[];
  onNavigate: (levelId: string) => void;
}

export function Breadcrumb({ path, onNavigate }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      <button
        onClick={() => onNavigate("root")}
        className="breadcrumb-item flex items-center gap-1"
      >
        <Home className="w-4 h-4" />
        <span className="hidden sm:inline">홈</span>
      </button>
      
      {path.map((item, index) => (
        <div key={item.id} className="flex items-center gap-1">
          <ChevronRight className="w-4 h-4 text-muted" />
          <button
            onClick={() => onNavigate(item.id)}
            className={cn(
              "breadcrumb-item",
              index === path.length - 1 && "breadcrumb-active"
            )}
          >
            {item.label}
          </button>
        </div>
      ))}
    </nav>
  );
}
