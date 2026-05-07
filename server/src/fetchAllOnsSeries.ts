import { fetchOnsSeriesBatch } from './onsApi'
import { isOnsSeriesStale } from './db'

export const ALL_ONS_SERIES: Array<{ cdid: string; datasetId: string }> = [
  // ─── GDP — Levels ───
  { cdid: 'YBHA', datasetId: 'ukea' },   // Nominal GDP CP SA £m
  { cdid: 'ABMI', datasetId: 'ukea' },   // Real GDP CVM SA £m
  { cdid: 'YBEZ', datasetId: 'ukea' },   // Real GDP index CVM SA
  { cdid: 'IHYQ', datasetId: 'pn2' },    // GDP QoQ % CVM SA
  { cdid: 'IHYP', datasetId: 'pn2' },    // GDP YoY % CVM SA

  // ─── Monthly GDP ───
  { cdid: 'ECY2', datasetId: 'mgdp' },   // Monthly GDP index CVM SA
  { cdid: 'ECY3', datasetId: 'mgdp' },   // Monthly GDP MoM %
  { cdid: 'A4GL', datasetId: 'mgdp' },   // Monthly GDP 3m/3m %
  { cdid: 'ECY6', datasetId: 'mgdp' },   // Services sector monthly index
  { cdid: 'ECY7', datasetId: 'mgdp' },   // Production sector monthly index
  { cdid: 'ECY8', datasetId: 'mgdp' },   // Construction sector monthly index

  // ─── GDP Expenditure Components (Real CVM SA £m) ───
  { cdid: 'ABJR', datasetId: 'ukea' },   // HH consumption CVM SA
  { cdid: 'NMRY', datasetId: 'ukea' },   // Govt consumption CVM SA
  { cdid: 'NPQT', datasetId: 'ukea' },   // GFCF CVM SA
  { cdid: 'NPEL', datasetId: 'ukea' },   // Business investment CVM SA
  { cdid: 'IKBK', datasetId: 'ukea' },   // Exports CVM SA
  { cdid: 'IKBL', datasetId: 'ukea' },   // Imports CVM SA
  { cdid: 'CAFU', datasetId: 'ukea' },   // Inventories CVM SA

  // ─── GDP Expenditure Components (Nominal CP SA £m) ───
  { cdid: 'ABJQ', datasetId: 'ukea' },   // HH consumption CP SA
  { cdid: 'NMRP', datasetId: 'ukea' },   // Govt consumption CP SA
  { cdid: 'NPQS', datasetId: 'ukea' },   // GFCF CP SA
  { cdid: 'IKBH', datasetId: 'ukea' },   // Exports CP SA
  { cdid: 'IKBI', datasetId: 'ukea' },   // Imports CP SA

  // ─── GDP Income Components (Nominal CP SA £m) ───
  { cdid: 'DTWM', datasetId: 'ukea' },   // Compensation of Employees
  { cdid: 'ROYJ', datasetId: 'ukea' },   // Wages & Salaries
  { cdid: 'ROYK', datasetId: 'ukea' },   // Employers' Social Contributions
  { cdid: 'CGBX', datasetId: 'ukea' },   // Gross Operating Surplus
  { cdid: 'ROYH', datasetId: 'ukea' },   // Mixed Income
  { cdid: 'CMVL', datasetId: 'ukea' },   // Taxes less Subsidies on Production

  // ─── COICOP HH Consumption Detail (Nominal CP SA £m) ───
  { cdid: 'ADIO', datasetId: 'ukea' },   // 01 Food & non-alcoholic beverages
  { cdid: 'ADIQ', datasetId: 'ukea' },   // 02 Alcohol, tobacco & narcotics
  { cdid: 'ADIV', datasetId: 'ukea' },   // 03 Clothing & footwear
  { cdid: 'ADIY', datasetId: 'ukea' },   // 04 Housing, water, energy & fuels
  { cdid: 'ADJE', datasetId: 'ukea' },   // 05 Furnishings & HH equipment
  { cdid: 'ADJG', datasetId: 'ukea' },   // 06 Health
  { cdid: 'ADJI', datasetId: 'ukea' },   // 07 Transport
  { cdid: 'ADJK', datasetId: 'ukea' },   // 08 Communication
  { cdid: 'ADJM', datasetId: 'ukea' },   // 09 Recreation & culture
  { cdid: 'ADJO', datasetId: 'ukea' },   // 10 Education
  { cdid: 'ADJQ', datasetId: 'ukea' },   // 11 Restaurants & hotels
  { cdid: 'ADJS', datasetId: 'ukea' },   // 12 Miscellaneous goods & services

  // ─── GFCF Detail + Other (Nominal CP SA £m) ───
  { cdid: 'ABNU', datasetId: 'ukea' },   // NPISH Consumption
  { cdid: 'NPEK', datasetId: 'ukea' },   // Business Investment
  { cdid: 'DFEE', datasetId: 'ukea' },   // Dwellings
  { cdid: 'DLWC', datasetId: 'ukea' },   // Other buildings & structures
  { cdid: 'DLWK', datasetId: 'ukea' },   // Transport equipment
  { cdid: 'DLWO', datasetId: 'ukea' },   // ICT & other machinery
  { cdid: 'DLWR', datasetId: 'ukea' },   // Intellectual property products
  { cdid: 'DFDI', datasetId: 'ukea' },   // Costs of ownership transfer
  { cdid: 'ABMP', datasetId: 'ukea' },   // Changes in inventories (nominal)

  // ─── Monthly GDP Sub-sectors (CVM SA Index) ───
  { cdid: 'ECYT', datasetId: 'mgdp' },   // Wholesale & Retail Trade
  { cdid: 'ECYU', datasetId: 'mgdp' },   // Transport & Storage
  { cdid: 'ECYV', datasetId: 'mgdp' },   // Accommodation & Food
  { cdid: 'ECYX', datasetId: 'mgdp' },   // Financial & Insurance
  { cdid: 'ECYY', datasetId: 'mgdp' },   // Real Estate
  { cdid: 'ECYZ', datasetId: 'mgdp' },   // Professional & Scientific
  { cdid: 'ECZ2', datasetId: 'mgdp' },   // Admin & Support

  // ─── UK Real GDP — Published Growth Rates ───
  { cdid: 'KGZ6', datasetId: 'pn2' },   // HH Consumption QoQ %
  { cdid: 'KGZ5', datasetId: 'pn2' },   // HH Consumption YoY %
  { cdid: 'KH2I', datasetId: 'pn2' },   // Govt QoQ %
  { cdid: 'KH2J', datasetId: 'pn2' },   // Govt YoY %
  { cdid: 'KG7N', datasetId: 'pn2' },   // GFCF QoQ %
  { cdid: 'KG7Q', datasetId: 'pn2' },   // GFCF YoY %
  { cdid: 'KH2U', datasetId: 'pn2' },   // Exports QoQ %
  { cdid: 'KH2V', datasetId: 'pn2' },   // Exports YoY %
  { cdid: 'KH3N', datasetId: 'pn2' },   // Imports QoQ %
  { cdid: 'KH3O', datasetId: 'pn2' },   // Imports YoY %

  // ─── UK Real GDP — CVM Expenditure Components (explorer) ───
  { cdid: 'ABNV', datasetId: 'ukea' },   // NPISH CVM
  { cdid: 'DFEG', datasetId: 'ukea' },   // Dwellings CVM
  { cdid: 'DLWF', datasetId: 'ukea' },   // Other buildings CVM
  { cdid: 'DLWN', datasetId: 'ukea' },   // Transport equipment CVM
  { cdid: 'DLWQ', datasetId: 'ukea' },   // ICT & machinery CVM
  { cdid: 'DLWT', datasetId: 'ukea' },   // IP products CVM
  { cdid: 'DFDK', datasetId: 'ukea' },   // Ownership transfer CVM

  // ─── UK Real GDP — COICOP CVM ───
  { cdid: 'ADIP', datasetId: 'ukea' },
  { cdid: 'ADIR', datasetId: 'ukea' },
  { cdid: 'ADIW', datasetId: 'ukea' },
  { cdid: 'ADIZ', datasetId: 'ukea' },
  { cdid: 'ADJF', datasetId: 'ukea' },
  { cdid: 'ADJH', datasetId: 'ukea' },
  { cdid: 'ADJJ', datasetId: 'ukea' },
  { cdid: 'ADJL', datasetId: 'ukea' },
  { cdid: 'ADJN', datasetId: 'ukea' },
  { cdid: 'ADJP', datasetId: 'ukea' },
  { cdid: 'ADJR', datasetId: 'ukea' },
  { cdid: 'ADJT', datasetId: 'ukea' },

  // ─── Trade ───
  { cdid: 'BOKI', datasetId: 'mret' },   // Trade in goods balance SA £m
  { cdid: 'BOKG', datasetId: 'mret' },   // Goods exports SA £m
  { cdid: 'BOKH', datasetId: 'mret' },   // Goods imports SA £m

  // ─── UK Retail Sales Volume (drsi) ───
  { cdid: 'J5EK', datasetId: 'drsi' },   // All retailing incl fuel volume SA
  { cdid: 'J467', datasetId: 'drsi' },   // All retailing excl fuel volume SA
  { cdid: 'J5DP', datasetId: 'drsi' },   // Predominantly Food Stores volume SA
  { cdid: 'J5DT', datasetId: 'drsi' },   // Predominantly Non-Food Stores volume SA
  { cdid: 'J5DV', datasetId: 'drsi' },   // Non-Specialised Stores volume SA
  { cdid: 'J5DX', datasetId: 'drsi' },   // Textile, Clothing & Footwear volume SA
  { cdid: 'J5E2', datasetId: 'drsi' },   // Household Goods Stores volume SA
  { cdid: 'J5E6', datasetId: 'drsi' },   // Other Non-Food Stores volume SA
  { cdid: 'J5DZ', datasetId: 'drsi' },   // Non-Store Retailing volume SA
  { cdid: 'J5EL', datasetId: 'drsi' },   // Automotive Fuel volume SA
  // ─── UK Retail Sales Value (drsi) ───
  { cdid: 'J5C4', datasetId: 'drsi' },   // All retailing incl fuel value SA
  { cdid: 'J468', datasetId: 'drsi' },   // All retailing excl fuel value SA
  { cdid: 'J459', datasetId: 'drsi' },   // Predominantly Food Stores value SA
  { cdid: 'J45D', datasetId: 'drsi' },   // Predominantly Non-Food Stores value SA
  { cdid: 'J45F', datasetId: 'drsi' },   // Non-Specialised Stores value SA
  { cdid: 'J45H', datasetId: 'drsi' },   // Textile, Clothing & Footwear value SA
  { cdid: 'J45L', datasetId: 'drsi' },   // Household Goods Stores value SA
  { cdid: 'J45P', datasetId: 'drsi' },   // Other Non-Food Stores value SA
  { cdid: 'J45T', datasetId: 'drsi' },   // Non-Store Retailing value SA
  { cdid: 'J5C8', datasetId: 'drsi' },   // Automotive Fuel value SA
  // ─── Internet + Deflators ───
  { cdid: 'J4MC', datasetId: 'drsi' },   // Internet as % of all retailing
  { cdid: 'J5HW', datasetId: 'drsi' },   // All retailing deflator YoY %
  { cdid: 'J5HQ', datasetId: 'drsi' },   // Food deflator YoY %
  { cdid: 'J5HR', datasetId: 'drsi' },   // Non-food deflator YoY %
  // ─── Retail Sales (legacy) ───
  { cdid: 'EAFV', datasetId: 'drsi' },   // Household goods value index
  { cdid: 'EAFU', datasetId: 'drsi' },   // Textiles clothing value index

  // ─── CPI ───
  { cdid: 'D7BT', datasetId: 'mm23' },   // CPI All Items index
  { cdid: 'D7G7', datasetId: 'mm23' },   // CPI All Items YoY %
  { cdid: 'D7OE', datasetId: 'mm23' },   // CPI All Items MoM %
  { cdid: 'DKO8', datasetId: 'mm23' },   // Core CPI YoY %
  { cdid: 'DKC6', datasetId: 'mm23' },   // Core CPI index (excl. energy/food/alcohol/tobacco)
  { cdid: 'D7G8', datasetId: 'mm23' },   // CPI Food YoY %
  { cdid: 'D7G9', datasetId: 'mm23' },   // CPI Alcohol & tobacco YoY %
  { cdid: 'D7GA', datasetId: 'mm23' },   // CPI Clothing YoY %
  { cdid: 'D7GB', datasetId: 'mm23' },   // CPI Housing YoY %
  { cdid: 'D7GC', datasetId: 'mm23' },   // CPI Furniture YoY %
  { cdid: 'D7GD', datasetId: 'mm23' },   // CPI Health YoY %
  { cdid: 'D7GE', datasetId: 'mm23' },   // CPI Transport YoY %
  { cdid: 'D7GF', datasetId: 'mm23' },   // CPI Communication YoY %
  { cdid: 'D7GG', datasetId: 'mm23' },   // CPI Recreation YoY %
  { cdid: 'D7GH', datasetId: 'mm23' },   // CPI Education YoY %
  { cdid: 'D7GI', datasetId: 'mm23' },   // CPI Restaurants YoY %
  { cdid: 'D7GJ', datasetId: 'mm23' },   // CPI Misc YoY %
  { cdid: 'L52I', datasetId: 'mm23' },   // CPI Goods YoY %
  { cdid: 'L52J', datasetId: 'mm23' },   // CPI Services YoY %

  // ─── CPIH ───
  { cdid: 'L522', datasetId: 'mm23' },   // CPIH index
  { cdid: 'L55O', datasetId: 'mm23' },   // CPIH YoY %
  { cdid: 'L55P', datasetId: 'mm23' },   // CPIH MoM %

  // ─── RPI ───
  { cdid: 'CHAW', datasetId: 'mm23' },   // RPI index
  { cdid: 'CZBH', datasetId: 'mm23' },   // RPI YoY %

  // ─── PPI ───
  { cdid: 'JVZ7', datasetId: 'ppi' },    // PPI Output index
  { cdid: 'GHIP', datasetId: 'ppi' },    // PPI Input index

  // ─── Labour Market ───
  { cdid: 'MGSX', datasetId: 'lms' },    // Unemployment rate 16+ SA %
  { cdid: 'LF24', datasetId: 'lms' },    // Employment rate 16-64 SA %
  { cdid: 'MGRZ', datasetId: 'lms' },    // Employment level 16+ SA 000s
  { cdid: 'MGSC', datasetId: 'unem' },   // Unemployment level 16+ SA 000s
  { cdid: 'LF2S', datasetId: 'lms' },    // Inactivity rate 16-64 SA %
  { cdid: 'MGWY', datasetId: 'lms' },    // Youth unemployment 16-24 SA %
  { cdid: 'BCJD', datasetId: 'lms' },    // Claimant count SA 000s
  { cdid: 'BCJE', datasetId: 'lms' },    // Claimant count rate SA %
  { cdid: 'AP2Y', datasetId: 'lms' },    // Vacancies 000s SA
  { cdid: 'KAB9', datasetId: 'lms' },    // AWE total pay YoY % SA
  { cdid: 'KAC3', datasetId: 'lms' },    // AWE regular pay YoY % SA
  { cdid: 'A3WW', datasetId: 'lms' },    // AWE real total pay YoY % SA

  // ─── Index of Production ───
  { cdid: 'K222', datasetId: 'diop' },   // Total production CVM SA
  { cdid: 'K22A', datasetId: 'diop' },   // Manufacturing CVM SA
  { cdid: 'K224', datasetId: 'diop' },   // Mining & quarrying CVM SA
  { cdid: 'K22C', datasetId: 'diop' },   // Electricity & gas CVM SA
  { cdid: 'K22E', datasetId: 'diop' },   // Water & waste CVM SA
  { cdid: 'K22G', datasetId: 'diop' },   // Food, beverages, tobacco
  { cdid: 'K22I', datasetId: 'diop' },   // Textiles, apparel, leather
  { cdid: 'K22K', datasetId: 'diop' },   // Wood, paper, printing
  { cdid: 'K22M', datasetId: 'diop' },   // Coke, petroleum
  { cdid: 'K22O', datasetId: 'diop' },   // Chemicals, pharmaceuticals
  { cdid: 'K22Q', datasetId: 'diop' },   // Rubber, plastics, minerals
  { cdid: 'K22S', datasetId: 'diop' },   // Basic metals, metal products
  { cdid: 'K22U', datasetId: 'diop' },   // Computer, electronic, optical
  { cdid: 'K22W', datasetId: 'diop' },   // Electrical equipment
  { cdid: 'K22Y', datasetId: 'diop' },   // Machinery & equipment
  { cdid: 'K230', datasetId: 'diop' },   // Transport equipment
  { cdid: 'K232', datasetId: 'diop' },   // Other manufacturing

  // ─── Retail Sales (additional) ───
  { cdid: 'J5KS', datasetId: 'drsi' },   // Internet sales value index SA

  // ─── House Prices ───
  { cdid: 'LPMB', datasetId: 'hpi' },    // UK HPI SA index
  { cdid: 'LPMC', datasetId: 'hpi' },    // UK HPI annual rate %
]

export async function syncAllOnsSeries(): Promise<void> {
  // Only sync stale series
  const stale = ALL_ONS_SERIES.filter(s => isOnsSeriesStale(s.cdid, s.datasetId, 12))
  if (stale.length === 0) {
    console.log(`[ONS] All ${ALL_ONS_SERIES.length} series are current.`)
    return
  }
  console.log(`[ONS] Starting sync of ${stale.length}/${ALL_ONS_SERIES.length} stale series...`)
  const start = Date.now()
  await fetchOnsSeriesBatch(stale)
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[ONS] Sync complete in ${elapsed}s`)
}
