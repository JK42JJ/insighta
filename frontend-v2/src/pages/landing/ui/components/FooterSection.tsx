import { Archive } from 'lucide-react';
import { Link } from 'react-router-dom';

export function FooterSection() {
  return (
    <div className="flex w-full flex-col items-start justify-start pt-10">
      <div className="flex h-auto flex-col items-stretch justify-between self-stretch pt-0 pr-0 pb-8 md:flex-row">
        {/* Brand column */}
        <div className="flex h-auto flex-col items-start justify-start gap-8 p-4 md:p-8">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-primary" />
            <span className="text-lg font-semibold">Insighta</span>
          </div>
          <div className="text-sm font-medium">
            <h2 className="text-lg font-medium">Organize insights that matter</h2>
            <p className="text-muted-foreground max-w-md">
              Capture ideas from any source, structure them with the Mandala
              framework, and let AI connect the dots.
            </p>
          </div>
          <div className="flex items-start justify-start gap-6">
            <a
              href="https://github.com/JK42JJ/insighta"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </a>
          </div>
        </div>

        {/* Link columns */}
        <div className="flex flex-col flex-wrap items-start justify-start gap-6 self-stretch p-4 sm:flex-row sm:justify-between md:gap-8 md:p-8">
          <div className="flex min-w-40 flex-1 flex-col items-start justify-start gap-3">
            <div className="self-stretch text-sm leading-5 font-medium">Product</div>
            <div className="flex flex-col items-start justify-end gap-2">
              <FooterLink label="Features" href="#features" />
              <FooterLink label="How it Works" href="#how-it-works" />
            </div>
          </div>

          <div className="flex min-w-40 flex-1 flex-col items-start justify-start gap-3">
            <div className="text-sm leading-5 font-medium">Legal</div>
            <div className="flex flex-col items-start justify-center gap-2">
              <Link to="/terms" className="text-muted-foreground hover:text-primary text-sm transition-colors">
                Terms of Service
              </Link>
              <Link to="/privacy" className="text-muted-foreground hover:text-primary text-sm transition-colors">
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t w-full px-4 py-4 md:px-8">
        <p className="text-muted-foreground text-xs text-center">
          &copy; {new Date().getFullYear()} Insighta. All rights reserved.
        </p>
      </div>
    </div>
  );
}

function FooterLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      className="text-muted-foreground hover:text-primary cursor-pointer text-sm leading-5 font-normal transition-colors"
    >
      {label}
    </a>
  );
}
