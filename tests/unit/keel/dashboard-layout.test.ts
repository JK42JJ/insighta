import { readFileSync } from 'fs';
import { join } from 'path';

interface Panel {
  id: number;
  title?: string;
  gridPos: { x: number; y: number; w: number; h: number };
}

const DASHBOARD = join(__dirname, '../../../charts/insighta/dashboards/invariants.json');
const AVAILABILITY_TITLE = '서비스 가용 현황';

function loadPanels(): Panel[] {
  return JSON.parse(readFileSync(DASHBOARD, 'utf8')).panels as Panel[];
}

function overlap(a: Panel['gridPos'], b: Panel['gridPos']): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('Keel dashboard layout', () => {
  it('puts the service availability panel above every other panel', () => {
    const panels = loadPanels();
    const availability = panels.find((p) => p.title === AVAILABILITY_TITLE);
    expect(availability).toBeDefined();
    expect(availability!.gridPos.y).toBe(0);
    for (const p of panels) {
      if (p !== availability) {
        expect(p.gridPos.y).toBeGreaterThanOrEqual(
          availability!.gridPos.y + availability!.gridPos.h
        );
      }
    }
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
