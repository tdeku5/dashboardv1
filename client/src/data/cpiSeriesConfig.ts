// ── CPI Series Explorer config ───────────────────────────────────────────────
// Flat list reflecting the BLS CPI hierarchy.
// Items are rendered as plain <option> tags; "—" prefixes indicate depth.

export const CPI_ITEMS: readonly { id: string; label: string }[] = [
  // ── Headline & Core Aggregates ──────────────────────────────────────────────
  { id: 'CPIAUCSL',        label: 'All Items (CPI)'                             },
  { id: 'CPILFESL',        label: 'Core CPI (Less Food & Energy)'               },
  { id: 'CPIULFSL',        label: 'All Items Less Food'                         },
  { id: 'CPILEGSL',        label: 'All Items Less Energy'                       },
  { id: 'CUSR0000SA0L2',   label: 'All Items Less Shelter'                      },
  { id: 'CUSR0000SA0L5',   label: 'All Items Less Medical Care'                 },

  // ── Food & Beverages ───────────────────────────────────────────────────────
  { id: 'CPIFABSL',        label: 'Food and Beverages'                          },
  { id: 'CPIUFDSL',        label: '— Food'                                     },
  { id: 'CUSR0000SAF11',   label: '— — Food at Home'                           },
  { id: 'CUSR0000SAF111',  label: '— — — Cereals and Bakery Products'          },
  { id: 'CUSR0000SAF112',  label: '— — — Meats, Poultry, Fish, and Eggs'       },
  { id: 'CUSR0000SEFJ',    label: '— — — Dairy and Related Products'           },
  { id: 'CUSR0000SAF113',  label: '— — — Fruits and Vegetables'                },
  { id: 'CUSR0000SAF114',  label: '— — — Nonalcoholic Beverages'               },
  { id: 'CUSR0000SEFP01',  label: '— — — — Coffee'                             },
  { id: 'CUSR0000SAF115',  label: '— — — Other Food at Home'                   },
  { id: 'CUSR0000SEFR',    label: '— — — — Sugar and Sweets'                   },
  { id: 'CUSR0000SEFS',    label: '— — — — Fats and Oils'                      },
  { id: 'CUSR0000SEFT',    label: '— — — — Other Foods'                        },
  { id: 'CUSR0000SEFV',    label: '— — Food Away from Home'                    },
  { id: 'CUSR0000SEFV05',  label: '— — — Other Food Away from Home'            },
  { id: 'CUSR0000SAF116',  label: '— Alcoholic Beverages'                      },
  { id: 'CUSR0000SEFW',    label: '— — Alcoholic Beverages at Home'            },
  { id: 'CUSR0000SEFX',    label: '— — Alcoholic Beverages Away from Home'     },

  // ── Housing ────────────────────────────────────────────────────────────────
  { id: 'CPIHOSSL',        label: 'Housing'                                    },
  { id: 'CUSR0000SAH1',    label: '— Shelter'                                  },
  { id: 'CUSR0000SEHA',    label: '— — Rent of Primary Residence'              },
  { id: 'CUSR0000SEHB',    label: '— — Lodging Away from Home'                 },
  { id: 'CUSR0000SEHC',    label: '— — Owners\u2019 Equivalent Rent of Residences' },
  { id: 'CUSR0000SEHC01',  label: '— — — OER of Primary Residence'             },
  { id: 'CUSR0000SAH2',    label: '— Fuels and Utilities'                      },
  { id: 'CUSR0000SAH21',   label: '— — Household Energy'                       },
  { id: 'CUSR0000SEHE',    label: '— — — Fuel Oil and Other Fuels'             },
  { id: 'CUSR0000SEHF',    label: '— — Energy Services'                        },
  { id: 'CUSR0000SEHF01',  label: '— — — Electricity'                          },
  { id: 'CUSR0000SEHF02',  label: '— — — Utility (Piped) Gas Service'          },
  { id: 'CUSR0000SEHG',    label: '— — Water, Sewer, and Trash Collection'     },
  { id: 'CUSR0000SAH3',    label: '— Household Furnishings and Operations'     },

  // ── Apparel ────────────────────────────────────────────────────────────────
  { id: 'CPIAPPSL',        label: 'Apparel'                                    },
  { id: 'CUSR0000SAA1',    label: '— Men\u2019s and Boys\u2019 Apparel'        },
  { id: 'CUSR0000SAA2',    label: '— Women\u2019s and Girls\u2019 Apparel'     },
  { id: 'CUSR0000SEAE',    label: '— Footwear'                                 },
  { id: 'CUSR0000SEAF',    label: '— Infants\u2019 and Toddlers\u2019 Apparel' },

  // ── Transportation ─────────────────────────────────────────────────────────
  { id: 'CPITRNSL',        label: 'Transportation'                              },
  { id: 'CUSR0000SAT1',    label: '— Private Transportation'                   },
  { id: 'CUSR0000SETA',    label: '— — New and Used Motor Vehicles'            },
  { id: 'CUSR0000SETA01',  label: '— — — New Vehicles'                         },
  { id: 'CUSR0000SETA02',  label: '— — — Used Cars and Trucks'                 },
  { id: 'CUSR0000SETB',    label: '— — Motor Fuel'                             },
  { id: 'CUSR0000SETB01',  label: '— — — Gasoline (All Types)'                 },
  { id: 'CUSR0000SETC',    label: '— — Motor Vehicle Parts and Equipment'      },
  { id: 'CUSR0000SETD',    label: '— — Motor Vehicle Maintenance and Repair'   },
  { id: 'CUSR0000SETG',    label: '— Public Transportation'                    },
  { id: 'CUSR0000SETG01',  label: '— — Airline Fares'                          },

  // ── Medical Care ───────────────────────────────────────────────────────────
  { id: 'CPIMEDSL',        label: 'Medical Care'                               },
  { id: 'CUSR0000SAM1',    label: '— Medical Care Commodities'                 },
  { id: 'CUSR0000SAM2',    label: '— Medical Care Services'                    },
  { id: 'CUSR0000SEMC',    label: '— — Professional Services'                  },
  { id: 'CUSR0000SEMC04',  label: '— — — Services by Other Medical Professionals' },
  { id: 'CUSR0000SEMD',    label: '— — Hospital and Related Services'          },

  // ── Recreation ─────────────────────────────────────────────────────────────
  { id: 'CPIRECSL',        label: 'Recreation'                                 },
  { id: 'CUSR0000SERA',    label: '— Video and Audio'                          },
  { id: 'CUSR0000SERA02',  label: '— — Cable, Satellite, and Live Streaming TV' },
  { id: 'CUSR0000SS61031', label: '— Pet Food and Treats'                      },
  { id: 'CUSR0000SERE01',  label: '— Toys'                                     },
  { id: 'CUSR0000SERE03',  label: '— Music Instruments and Accessories'        },
  { id: 'CUSR0000SERF01',  label: '— Club Memberships / Participant Sports Fees' },
  { id: 'CUSR0000SS62031', label: '— Admission to Movies, Theaters, and Concerts' },
  { id: 'CUSR0000SERF03',  label: '— Fees for Lessons or Instructions'         },

  // ── Education & Communication ──────────────────────────────────────────────
  { id: 'CPIEDUSL',        label: 'Education and Communication'                },
  { id: 'CUSR0000SAE1',    label: '— Education'                                },
  { id: 'CUSR0000SEEA',    label: '— — Educational Books and Supplies'         },
  { id: 'CUSR0000SEEB',    label: '— — Tuition, Other School Fees, and Childcare' },
  { id: 'CUSR0000SAE2',    label: '— Communication'                            },
  { id: 'CUSR0000SAE21',   label: '— — Information and Information Processing' },
  { id: 'CUSR0000SEEE',    label: '— — — IT, Hardware and Services'            },
  { id: 'CUSR0000SEEE01',  label: '— — — — Computers, Peripherals, and Smart Home Assistants' },

  // ── Other Goods & Services ─────────────────────────────────────────────────
  { id: 'CPIOGSSL',        label: 'Other Goods and Services'                   },
  { id: 'CUSR0000SEGA',    label: '— Tobacco and Smoking Products'             },
  { id: 'CUSR0000SAG1',    label: '— Personal Care'                            },
  { id: 'CUSR0000SEGD',    label: '— — Miscellaneous Personal Services'        },
  { id: 'CUSR0000SEGD03',  label: '— — — Laundry and Dry Cleaning Services'    },

  // ── Special Aggregates — Commodities / Services / Durables Splits ──────────
  { id: 'CUSR0000SAC',     label: 'Commodities'                                },
  { id: 'CUSR0000SACL1',   label: '— Commodities Less Food'                    },
  { id: 'CUSR0000SACL11',  label: '— — Commodities Less Food and Beverages'    },
  { id: 'CUSR0000SACL1E',  label: '— — Commodities Less Food and Energy Commodities' },
  { id: 'CPIENGSL',        label: 'Energy'                                     },
  { id: 'CUSR0000SACE',    label: '— Energy Commodities'                       },
  { id: 'CUSR0000SAD',     label: 'Durables'                                   },
  { id: 'CUSR0000SAN',     label: 'Nondurables'                                },
  { id: 'CUSR0000SANL1',   label: '— Nondurables Less Food'                    },
  { id: 'CUSR0000SANL13',  label: '— — Nondurables Less Food and Apparel'      },
  { id: 'CUSR0000SANL11',  label: '— Nondurables Less Food and Beverages'      },
  { id: 'CUSR0000SANL113', label: '— — Nondurables Less Food, Beverages, and Apparel' },
  { id: 'CUSR0000SAS',     label: 'Services'                                   },
  { id: 'CUSR0000SASLE',   label: '— Services Less Energy Services'            },
  { id: 'CUSR0000SASL5',   label: '— Services Less Medical Care Services'      },
  { id: 'CUSR0000SASL2RS', label: '— Services Less Rent of Shelter'            },
  { id: 'CUSR0000SAS4',    label: '— Transportation Services'                  },
  { id: 'CUSR0000SAS367',  label: 'Other Services'                             },
  { id: 'CUSR0000SAS2RS',  label: 'Rent of Shelter'                            },
  { id: 'CUSR0000SA311',   label: 'Apparel Less Footwear'                      },
  { id: 'CUSR0000SERAC',   label: 'Video and Audio Products'                   },
] as const
