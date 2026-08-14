// White pictograms for the node-image program — the reference demo's "colored disc with
// white icon" look (original: ./images/<tag>.svg per node tag). Ours map the
// ontology node types. Hand-authored 24×24 lucide-style strokes, inlined as
// data URIs so no asset pipeline / network fetch is involved.

import type { OntologyNodeType } from './types';

function svgUri(body: string, filled = false): string {
  // width/height are REQUIRED: @sigma/node-image's loadSVGImage throws
  // "cannot use `size` if target SVG has no definite dimensions" when the
  // program is created with a size option (as the reference demo does) and the
  // SVG only carries a viewBox — the icon then silently never renders.
  //
  // viewBox is padded (24×24 art inside a 40×40 frame): the original demo's
  // pictograms occupy ~60% of the disc diameter — edge-to-edge icons read as
  // bloated stickers (2026-07-27 side-by-side).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="-8 -8 40 40" ` +
    (filled
      ? `fill="white" stroke="none"`
      : `fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`) +
    `>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// One pictogram per node type (design §6). Unknown types → undefined → the
// program renders the plain colored disc, which is a safe degradation.
export const TYPE_IMAGE: Partial<Record<OntologyNodeType, string>> = {
  mandala: svgUri(
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'
  ),
  mandala_sector: svgUri(
    '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>'
  ),
  goal: svgUri(
    '<path d="M5 21V3"/><path d="M5 4h13a1 1 0 0 1 .8 1.6L16.5 8l2.3 2.4a1 1 0 0 1-.8 1.6H5z" fill="white" stroke="none"/>'
  ),
  topic: svgUri(
    '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>'
  ),
  video_resource: svgUri('<path d="M7 4.5v15l13-7.5z"/>', true),
  concept: svgUri(
    '<path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/><path d="M9 20h6"/><path d="M10 23h4"/>'
  ),
  note: svgUri(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>'
  ),
  section_node: svgUri(
    '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>'
  ),
  atom_node: svgUri('<circle cx="12" cy="12" r="5"/>', true),
  action_node: svgUri('<path d="M20 6 9 17l-5-5"/>'),
  insight: svgUri(
    '<path d="M12 3l1.9 5.8L20 10l-5 3.9L16.2 21 12 17.3 7.8 21 9 13.9 4 10l6.1-1.2z"/>',
    true
  ),
  resource: svgUri(
    '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>'
  ),
  source: svgUri(
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>'
  ),
  source_segment: svgUri('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
};
