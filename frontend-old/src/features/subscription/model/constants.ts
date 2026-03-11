export const PRICING_TIERS = [
  {
    id: 'pioneer',
    nameKey: 'upgrade.pioneer.name',
    price: '$99',
    periodKey: 'upgrade.pioneer.period',
    featuresKey: 'upgrade.pioneer.features',
    highlight: true,
  },
  {
    id: 'pro-monthly',
    nameKey: 'upgrade.proMonthly.name',
    price: '$9',
    periodKey: 'upgrade.proMonthly.period',
    featuresKey: 'upgrade.proMonthly.features',
  },
  {
    id: 'pro-annual',
    nameKey: 'upgrade.proAnnual.name',
    price: '$89',
    periodKey: 'upgrade.proAnnual.period',
    featuresKey: 'upgrade.proAnnual.features',
    badgeKey: 'upgrade.proAnnual.badge',
  },
] as const;
