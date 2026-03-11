import { useTranslation } from 'react-i18next';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

interface SubjectRadarChartProps {
  subjects: string[];
  cardsByCell: Record<number, { length: number } | unknown[]>;
}

export function SubjectRadarChart({ subjects, cardsByCell }: SubjectRadarChartProps) {
  const { t } = useTranslation();

  const data = subjects.map((subject, idx) => {
    const cards = cardsByCell[idx];
    const count = Array.isArray(cards) ? cards.length : 0;
    return {
      subject: subject || `#${idx + 1}`,
      count,
    };
  });

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2">
        <h3 className="text-sm font-semibold">{t('dashboard.focusMap')}</h3>
        <p className="text-xs text-muted-foreground">{t('dashboard.focusMapDesc')}</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          />
          <Radar
            dataKey="count"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.2}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
