export const COUNTRIES = [
  { key: 'us', label: 'US' },
  { key: 'uk', label: 'UK' },
  { key: 'de', label: 'GERMANY' },
  { key: 'it', label: 'ITALY' },
  { key: 'fr', label: 'FRANCE' },
  { key: 'ca', label: 'CANADA' },
  { key: 'au', label: 'AUSTRALIA' },
  { key: 'jp', label: 'JAPAN' },
] as const

export const CATEGORIES = [
  { key: 'growth', label: 'GROWTH', path: '/models/growth' },
  { key: 'inflation', label: 'INFLATION', path: '/models/inflation' },
  { key: 'labor', label: 'LABOR', path: '/models/labor' },
  { key: 'fiscal', label: 'FISCAL', path: '/models/fiscal' },
  { key: 'industrial', label: 'INDUSTRIAL PRODUCTION', path: '/models/industrial' },
  { key: 'housing', label: 'HOUSING', path: '/models/housing' },
  { key: 'credit', label: 'CREDIT', path: '/models/credit' },
] as const
