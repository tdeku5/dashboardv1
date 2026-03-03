// ── PCE Series Explorer config ──────────────────────────────────────────────
// Line items from BEA NIPA Underlying Detail Table 2.3.4U
// (Price Indexes for Personal Consumption Expenditures)
// "—" prefixes indicate hierarchy depth in the dropdown.

export const PCE_ITEMS: readonly { lineNumber: number; label: string }[] = [
  { lineNumber: 1,  label: 'Personal Consumption Expenditures'                },
  { lineNumber: 2,  label: '— Goods'                                         },
  { lineNumber: 3,  label: '— — Durable Goods'                               },
  { lineNumber: 4,  label: '— — — Motor Vehicles and Parts'                  },
  { lineNumber: 5,  label: '— — — Furnishings and Durable Household Equipment' },
  { lineNumber: 6,  label: '— — — Recreational Goods and Vehicles'           },
  { lineNumber: 7,  label: '— — — Other Durable Goods'                       },
  { lineNumber: 8,  label: '— — Nondurable Goods'                            },
  { lineNumber: 9,  label: '— — — Food and Beverages for Off-Premises Consumption' },
  { lineNumber: 10, label: '— — — Clothing and Footwear'                     },
  { lineNumber: 11, label: '— — — Gasoline and Other Energy Goods'           },
  { lineNumber: 12, label: '— — — Other Nondurable Goods'                    },
  { lineNumber: 13, label: '— Services'                                      },
  { lineNumber: 14, label: '— — Household Consumption Expenditures (Services)' },
  { lineNumber: 15, label: '— — — Housing and Utilities'                     },
  { lineNumber: 16, label: '— — — Health Care'                               },
  { lineNumber: 17, label: '— — — Transportation Services'                   },
  { lineNumber: 18, label: '— — — Recreation Services'                       },
  { lineNumber: 19, label: '— — — Food Services and Accommodations'          },
  { lineNumber: 20, label: '— — — Financial Services and Insurance'          },
  { lineNumber: 21, label: '— — — Other Services'                            },
  { lineNumber: 22, label: '— — Final Consumption Expenditures of NPISHs'    },
  { lineNumber: 25, label: 'Core PCE (Excluding Food and Energy)'            },
] as const
