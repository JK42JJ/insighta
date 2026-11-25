/** Path and the `view` of the address; nothing else of the query is sent. */
export function feedbackPath(loc: { pathname: string; search: string }): string {
  const view = new URLSearchParams(loc.search).get('view');
  return loc.pathname + (view && /^[\w-]+$/.test(view) ? '?view=' + view : '');
}
