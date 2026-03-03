// ── PPI Series Explorer config ──────────────────────────────────────────────
// Flat list reflecting the BLS PPI Final Demand hierarchy (Table 7, SA).
// Items are rendered as plain <option> tags; "—" prefixes indicate depth.

export const PPI_ITEMS: readonly { id: string; label: string }[] = [
  // ── Headline & Core Aggregates ──────────────────────────────────────────────
  { id: 'PPIFIS',       label: 'Final Demand (PPI)'                              },
  { id: 'PPIFES',       label: 'Core PPI (Less Foods & Energy)'                  },
  { id: 'WPSFD49116',   label: 'Super-Core PPI (Less Foods, Energy & Trade Svcs)'},

  // ── Final Demand by Type ──────────────────────────────────────────────────
  { id: 'PPIDGS',       label: 'Final Demand Goods'                              },
  { id: 'WPSFD413',     label: '— Final Demand Goods Less Foods & Energy'        },
  { id: 'PPIDFS',       label: '— Final Demand Foods'                            },
  { id: 'PPIDES',       label: '— Final Demand Energy'                           },
  { id: 'PPIDSS',       label: 'Final Demand Services'                           },
  { id: 'PPIAWS',       label: '— Final Demand Trade, Warehousing & Transport'   },
  { id: 'PPITWS',       label: '— Final Demand Transport & Warehousing Services' },
  { id: 'PPIDCS',       label: '— Final Demand Construction'                     },

  // ── Finished Goods (Legacy/Supplemental) ──────────────────────────────────
  { id: 'WPSFD49207',   label: 'Finished Goods'                                  },
  { id: 'WPSFD4131',    label: '— Finished Goods Less Foods & Energy'            },
  { id: 'WPSFD49201',   label: 'Total Finished'                                  },
  { id: 'WPSFD49215',   label: 'Total Private Capital Investment'                },
  { id: 'WPSFD4111',       label: 'Finished Consumer Foods'                         },
  { id: 'WPSFD431',     label: 'Finished Consumer Goods'                         },
  { id: 'WPSFD4121',    label: 'Finished Consumer Goods Less Foods'              },
] as const
