import { readFileSync } from 'fs';
import { join } from 'path';

interface Panel {
  id: number;
  type: string;
  title?: string;
  datasource?: { type?: string; uid?: string };
  gridPos: { x: number; y: number; w: number; h: number };
}

const DASHBOARD = join(__dirname, '../../../charts/insighta/dashboards/invariants.json');
const SECTION_ORDER = ['서비스 정상여부', '장애 대응', '비용', '성능'];
const AVAILABILITY_TITLE = '서비스 가용 현황';
const TIMELINE_TITLE = '서비스 가용 이력';

function loadPanels(): Panel[] {
  return JSON.parse(readFileSync(DASHBOARD, 'utf8')).panels as Panel[];
}

function overlap(a: Panel['gridPos'], b: Panel['gridPos']): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Rows in top-to-bottom order, each with the y where the next row starts. */
function sections(panels: Panel[]): Array<{ title: string; from: number; to: number }> {
  const rows = panels.filter((p) => p.type === 'row').sort((a, b) => a.gridPos.y - b.gridPos.y);
  return rows.map((r, i) => {
    const next = rows[i + 1];
    return { title: r.title ?? '', from: r.gridPos.y, to: next ? next.gridPos.y : Infinity };
  });
}

function sectionOf(panels: Panel[], title: string): string {
  const panel = panels.find((p) => p.title === title);
  if (!panel) return '(missing)';
  const hit = sections(panels).find((s) => panel.gridPos.y > s.from && panel.gridPos.y < s.to);
  return hit ? hit.title : '(outside)';
}

describe('Keel dashboard layout', () => {
  it('orders the sections: service health, incident response, cost, performance', () => {
    const titles = sections(loadPanels()).map((s) => s.title);
    const head = titles.slice(0, SECTION_ORDER.length);
    SECTION_ORDER.forEach((name, i) => expect(head[i]).toContain(name));
  });

  it('starts with the service health section, with nothing above it', () => {
    const panels = loadPanels();
    const first = sections(panels)[0];
    expect(first?.from).toBe(0);
    expect(first?.title).toContain(SECTION_ORDER[0]);
  });

  it('shows availability and its timeline inside the service health section', () => {
    const panels = loadPanels();
    expect(sectionOf(panels, AVAILABILITY_TITLE)).toContain(SECTION_ORDER[0]);
    expect(sectionOf(panels, TIMELINE_TITLE)).toContain(SECTION_ORDER[0]);
  });

  it('puts the performance panels in the performance section on the metrics datasource', () => {
    const panels = loadPanels();
    const perf = sections(panels).find((s) => s.title.includes('성능'));
    const inside = panels.filter(
      (p) =>
        perf &&
        p.type !== 'row' &&
        p.type !== 'text' &&
        p.gridPos.y > perf.from &&
        p.gridPos.y < perf.to
    );
    expect(inside.length).toBeGreaterThan(0);
    for (const p of inside) expect(p.datasource?.type).toBe('prometheus');
  });

  it('has unique panel ids', () => {
    const ids = loadPanels().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no two panels occupying the same grid cells', () => {
    const panels = loadPanels();
    const overlapping: Array<[number, number]> = [];
    panels.forEach((a, i) => {
      for (const b of panels.slice(i + 1)) {
        if (overlap(a.gridPos, b.gridPos)) overlapping.push([a.id, b.id]);
      }
    });
    expect(overlapping).toEqual([]);
  });
});
