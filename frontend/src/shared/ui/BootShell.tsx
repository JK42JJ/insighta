/**
 * BootShell — the React-rendered twin of the static HTML shell in
 * `index.html`. Used for transient full-screen loading states (auth
 * resolving, lazy page loading) so the visual language stays identical
 * from "browser parsed HTML" to "React rendered placeholder". No layout
 * shift, no brand flash between the two.
 *
 * Keep the markup in sync with the `<div id="boot-shell">` block in
 * `index.html`. The `boot-shell-pulse` keyframe lives in that file's
 * <style>, so it is available globally at runtime for the inline
 * `animation` style below.
 *
 * Rollback: delete this file + restore any call sites.
 */
export function BootShell() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5 pointer-events-none bg-background"
      role="presentation"
      aria-hidden="true"
    >
      <div className="text-[28px] font-semibold tracking-tight text-foreground/90">Insighta</div>
      <div
        className="h-[3px] w-12 rounded-sm bg-foreground/30"
        style={{ animation: 'boot-shell-pulse 1.4s ease-in-out infinite' }}
      />
    </div>
  );
}
