import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';
import { InsightCard } from '@/types/mandala';

interface QualityBreakdownProps {
  cards: InsightCard[];
}

export function QualityBreakdown({ cards }: QualityBreakdownProps) {
  const { t } = useTranslation();

  const withMemo = cards.filter((c) => c.userNote && c.userNote.trim().length > 0).length;
  const withoutMemo = cards.length - withMemo;

  const data = [
    { name: t('dashboard.withMemo'), value: withMemo, color: 'hsl(var(--primary))' },
    { name: t('dashboard.withoutMemo'), value: withoutMemo, color: 'hsl(var(--muted-foreground))' },
  ];

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2">
        <h3 className="text-sm font-semibold">{t('dashboard.qualityAnalysis')}</h3>
        <p className="text-xs text-muted-foreground">{t('dashboard.qualityAnalysisDesc')}</p>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={80}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-muted-foreground mt-1">
        <span>
          {t('dashboard.withMemo')}: <strong className="text-foreground">{withMemo}</strong>
        </span>
        <span>
          {t('dashboard.withoutMemo')}: <strong className="text-foreground">{withoutMemo}</strong>
        </span>
      </div>
    </div>
  );
}
