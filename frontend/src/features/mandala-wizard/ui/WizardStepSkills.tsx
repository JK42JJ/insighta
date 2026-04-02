import { useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Bell, Shield, BarChart3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { SkillType } from '@/shared/types/mandala-ux';

import './mandala-wizard.css';

// ─── Skill card data ───

interface SkillCardData {
  type: SkillType;
  nameKey: string;
  descKey: string;
  tier: 'FREE' | 'PRO';
  icon: LucideIcon;
  demoKey: 'mail' | 'bell' | 'shield' | 'chart';
  proHintKey?: string;
}

const SKILL_CARDS: SkillCardData[] = [
  {
    type: 'newsletter',
    nameKey: 'wizard.skill.newsletter.name',
    descKey: 'wizard.skill.newsletter.desc',
    tier: 'FREE',
    icon: Mail,
    demoKey: 'mail',
  },
  {
    type: 'alerts',
    nameKey: 'wizard.skill.alerts.name',
    descKey: 'wizard.skill.alerts.desc',
    tier: 'FREE',
    icon: Bell,
    demoKey: 'bell',
  },
  {
    type: 'bias_filter',
    nameKey: 'wizard.skill.biasFilter.name',
    descKey: 'wizard.skill.biasFilter.desc',
    tier: 'FREE',
    icon: Shield,
    demoKey: 'shield',
  },
  {
    type: 'report',
    nameKey: 'wizard.skill.report.name',
    descKey: 'wizard.skill.report.desc',
    tier: 'PRO',
    icon: BarChart3,
    demoKey: 'chart',
    proHintKey: 'wizard.skill.report.proHint',
  },
];

// ─── Demo animations ───

function DemoMail() {
  const { t } = useTranslation();
  return (
    <div className="demo-mail">
      <div className="env">
        <div className="env-flap" />
        <div className="env-line" />
        <div className="env-line2" />
      </div>
      <div className="demo-label">{t('wizard.skill.demo.mail')}</div>
    </div>
  );
}

function DemoBell() {
  const { t } = useTranslation();
  return (
    <div className="demo-bell">
      <Bell className="bell-icon h-7 w-7 text-emerald-400 opacity-40" />
      <div className="toast">{t('wizard.skill.demo.bell')}</div>
    </div>
  );
}

function DemoBias() {
  const { t } = useTranslation();
  return (
    <div className="demo-bias">
      <div className="fake-thumb">{t('wizard.skill.demo.bias.thumbnail')}</div>
      <div className="stamp">{t('wizard.skill.demo.bias.stamp')}</div>
      <div className="bias-label">{t('wizard.skill.demo.bias.label')}</div>
    </div>
  );
}

function DemoChart() {
  const { t } = useTranslation();
  return (
    <div className="demo-chart">
      <div className="bar b1" />
      <div className="bar b2" />
      <div className="bar b3" />
      <div className="bar b4" />
      <div className="demo-chart-label">{t('wizard.skill.demo.chart')}</div>
    </div>
  );
}

const DEMO_COMPONENTS: Record<string, React.FC> = {
  mail: DemoMail,
  bell: DemoBell,
  shield: DemoBias,
  chart: DemoChart,
};

// ─── Component ───

interface WizardStepSkillsProps {
  skills: Record<SkillType, boolean>;
  onSetSkill: (type: SkillType, enabled: boolean) => void;
  onComplete: () => void;
  isCreating: boolean;
}

export default function WizardStepSkills({
  skills,
  onSetSkill,
  onComplete,
  isCreating,
}: WizardStepSkillsProps) {
  const { t } = useTranslation();

  // Replay animations when step mounts by toggling a key
  const replayKey = useRef(0);
  useEffect(() => {
    replayKey.current += 1;
  }, []);

  return (
    <div className="wizard-step-enter">
      <h1 className="text-[28px] font-black leading-tight tracking-tight">
        {t('wizard.skills.title')}
      </h1>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
        {t('wizard.skills.subtitle')}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3.5">
        {SKILL_CARDS.map((card) => {
          const isOn = skills[card.type];
          const Demo = DEMO_COMPONENTS[card.demoKey];

          return (
            <SkillCard
              key={card.type}
              card={card}
              isOn={isOn}
              Demo={Demo}
              onToggle={() => onSetSkill(card.type, !isOn)}
            />
          );
        })}
      </div>

      <div className="mt-9 text-center">
        <button
          type="button"
          onClick={onComplete}
          disabled={isCreating}
          className="inline-flex items-center gap-[7px] rounded-xl border-0 bg-primary px-7 py-[11px] text-sm font-bold text-primary-foreground shadow-[0_3px_14px_hsl(var(--primary)/0.25),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_5px_22px_hsl(var(--primary)/0.35)] active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
        >
          {isCreating ? t('wizard.skills.button.creating') : t('wizard.skills.button.start')}
        </button>
      </div>
    </div>
  );
}

// ─── Individual skill card ───

interface SkillCardProps {
  card: SkillCardData;
  isOn: boolean;
  Demo: React.FC;
  onToggle: () => void;
}

function SkillCard({ card, isOn, Demo, onToggle }: SkillCardProps) {
  const { t } = useTranslation();

  // Clone demo node to replay animation on toggle ON
  const demoRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    onToggle();
    // Force animation replay when toggling ON
    if (!isOn && demoRef.current) {
      const parent = demoRef.current;
      const clone = parent.cloneNode(true) as HTMLDivElement;
      parent.replaceWith(clone);
    }
  }, [isOn, onToggle]);

  const stateClass = isOn ? 'is-on' : 'is-off';
  const name = t(card.nameKey);

  return (
    <div
      className={`sk-card ${stateClass}`}
      data-sk={card.demoKey}
      role="switch"
      aria-checked={isOn}
      aria-label={`${name} ${isOn ? t('wizard.skills.state.active') : t('wizard.skills.state.inactive')}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggle();
        }
      }}
    >
      {/* Tier badge */}
      <div className={`tier-badge ${card.tier === 'FREE' ? 'tier-free' : 'tier-pro'}`}>
        {card.tier}
      </div>

      {/* Demo area */}
      <div className="sk-demo" ref={demoRef}>
        <div className="sk-demo-off">{t('wizard.skills.card.preview')}</div>
        <Demo />
      </div>

      {/* Info */}
      <div className="sk-info">
        <div className="sk-name">{name}</div>
        <div className="sk-desc-text">{t(card.descKey)}</div>
      </div>

      {/* Pro hint */}
      {card.proHintKey && <div className="sk-pro-hint">{t(card.proHintKey)}</div>}

      {/* Toggle */}
      <div className="sk-toggle" onClick={handleToggle}>
        <span>{t('wizard.skills.card.toggle')}</span>
        <div className="sk-switch" />
      </div>
    </div>
  );
}
