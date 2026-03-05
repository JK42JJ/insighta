import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="py-6 text-center text-sm text-muted-foreground space-y-1">
      <div className="flex items-center justify-center gap-3">
        <Link to="/terms" className="hover:text-foreground transition-colors">
          Terms of Service
        </Link>
        <span>·</span>
        <Link to="/privacy" className="hover:text-foreground transition-colors">
          Privacy Policy
        </Link>
      </div>
      <p>&copy; 2026 Insighta. All rights reserved.</p>
    </footer>
  );
}
