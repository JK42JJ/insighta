import { Archive, Github } from 'lucide-react';
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
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github className="w-5 h-5" />
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
