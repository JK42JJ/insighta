import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Bell, ShieldAlert, FileBarChart } from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import type { SkillType } from '@/shared/types/mandala-ux';

const SKILL_META: Record<SkillType, { labelKey: string; icon: React.ReactNode; color: string }> = {
  newsletter: {
    labelKey: 'dashboard.skills.newsletter',
    icon: <Mail className="h-3.5 w-3.5 flex-shrink-0" />,
    color: 'hsl(var(--primary))',
  },
  alerts: {
    labelKey: 'dashboard.skills.alerts',
    icon: <Bell className="h-3.5 w-3.5 flex-shrink-0" />,
    color: '#38d9a9',
  },
  bias_filter: {
    labelKey: 'dashboard.skills.biasFilter',
    icon: <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />,
    color: '#fcc419',
  },
  report: {
    labelKey: 'dashboard.skills.report',
    icon: <FileBarChart className="h-3.5 w-3.5 flex-shrink-0" />,
    color: '#ff6b6b',
  },
};

interface SkillChipsProps {
  mandalaId: string;
  skills: Record<SkillType, boolean>;
}

async function patchSkill(mandalaId: string, skillType: string, enabled: boolean) {
  await apiClient.tokenReady;
  const token = apiClient.getAccessToken();
  const baseUrl = (apiClient as unknown as { baseUrl: string }).baseUrl;
  await fetch(`${baseUrl}/api/v1/mandalas/${mandalaId}/skills`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ skillType, enabled }),
  });
}

export function SkillChips({ mandalaId, skills }: SkillChipsProps) {
  const { t } = useTranslation();
  const [localSkills, setLocalSkills] = useState(skills);

  useEffect(() => {
    setLocalSkills(skills);
  }, [skills]);

  const toggle = (key: SkillType) => {
    const newValue = !localSkills[key];
    setLocalSkills((prev) => ({ ...prev, [key]: newValue }));
    patchSkill(mandalaId, key, newValue);
  };

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {(Object.keys(SKILL_META) as SkillType[]).map((key) => {
        const meta = SKILL_META[key];
        const isOn = localSkills[key] ?? false;

        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:border-border/80"
          >
            <span style={{ color: meta.color, opacity: 0.6 }}>{meta.icon}</span>
            {t(meta.labelKey)}
            <span
              className={[
                'rounded-full px-1.5 py-px text-[9.5px] font-bold',
                isOn ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground',
              ].join(' ')}
            >
              {isOn ? 'ON' : 'OFF'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
