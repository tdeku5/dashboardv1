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
  { cdid: 'ED3H', datasetId: 'mgdp' },   // Monthly GDP 3m/3m % (replaces dead 'A4GL', verified 2026-07)
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
  // NOTE 2026-07: dead CDIDs 'DFEE', 'DLWC', 'DLWR', 'DFDI' removed (404 on the
  // ONS API — never populated any rows). Verified partial replacements added
  // below; dwellings/other-buildings/IP nominal levels are deferred pending
  // verified codes. Surviving codes in this block predate the audit — their
  // concept labels are unverified and should be re-checked before Phase 3 use.
  { cdid: 'ABNU', datasetId: 'ukea' },   // NPISH Consumption
  { cdid: 'NPEK', datasetId: 'ukea' },   // Business Investment
  { cdid: 'DLWK', datasetId: 'ukea' },   // Transport equipment
  { cdid: 'DLWO', datasetId: 'ukea' },   // ICT & other machinery
  { cdid: 'ABMP', datasetId: 'ukea' },   // Changes in inventories (nominal)
  { cdid: 'TLPX', datasetId: 'cxnv' },   // GFCF total transport equipment CP SA £m (verified 2026-07)
  { cdid: 'L62U', datasetId: 'cxnv' },   // GFCF private-sector transfer-of-ownership costs CP SA £m (verified 2026-07)

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
  // NOTE 2026-07: dead CDID 'DLWN' (transport equipment CVM) removed — 404 on
  // the ONS API; verified replacement deferred.
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
  // NOTE 2026-07: dead sector-split CDIDs replaced with codes verified live
  // against the ONS search API (dead: J5DP/J5DT/J5DV/J5DX/J5E2/J5E6/J5EL and
  // J459/J45D/J45F/J45P/J5C8 — all 404, never populated). Deflator YoY codes
  // J5HQ/J5HR and internet value J5KS also dead — removed, replacements
  // deferred (implied deflators can be computed from value/volume pairs).
  { cdid: 'J5EK', datasetId: 'drsi' },   // All retailing incl fuel volume SA
  { cdid: 'J467', datasetId: 'drsi' },   // All retailing excl fuel volume SA
  { cdid: 'EAPT', datasetId: 'drsi' },   // Predominantly Food Stores volume SA
  { cdid: 'EAPV', datasetId: 'drsi' },   // Predominantly Non-Food Stores volume SA
  { cdid: 'EAPU', datasetId: 'drsi' },   // Non-Specialised Stores volume SA
  { cdid: 'EAPX', datasetId: 'drsi' },   // Textiles, Clothing & Footwear volume SA
  { cdid: 'EAPY', datasetId: 'drsi' },   // Household Goods Stores volume SA
  { cdid: 'EAPW', datasetId: 'drsi' },   // Other Non-Food Stores volume SA
  { cdid: 'J5DZ', datasetId: 'drsi' },   // Non-Store Retailing volume SA
  { cdid: 'JO5A', datasetId: 'drsi' },   // Automotive Fuel volume SA
  // ─── UK Retail Sales Value (drsi) ───
  { cdid: 'J5C4', datasetId: 'drsi' },   // All retailing incl fuel value SA
  { cdid: 'J468', datasetId: 'drsi' },   // All retailing excl fuel value SA
  { cdid: 'EAQW', datasetId: 'drsi' },   // Predominantly Food Stores value SA
  { cdid: 'EAQY', datasetId: 'drsi' },   // Predominantly Non-Food Stores value SA
  { cdid: 'EAQX', datasetId: 'drsi' },   // Non-Specialised Stores value SA
  { cdid: 'J45H', datasetId: 'drsi' },   // Textiles, Clothing & Footwear value SA (pre-existing)
  { cdid: 'EARA', datasetId: 'drsi' },   // Textiles, Clothing & Footwear value SA (verified 2026-07)
  { cdid: 'J45L', datasetId: 'drsi' },   // Household Goods Stores value SA (pre-existing)
  { cdid: 'EARB', datasetId: 'drsi' },   // Household Goods Stores value SA (verified 2026-07)
  { cdid: 'J45T', datasetId: 'drsi' },   // Non-Store Retailing value SA (pre-existing)
  { cdid: 'J5BI', datasetId: 'drsi' },   // Non-Store Retailing value SA (verified 2026-07)
  { cdid: 'JO2G', datasetId: 'drsi' },   // Automotive Fuel value SA
  // ─── Internet + Deflators ───
  { cdid: 'J4MC', datasetId: 'drsi' },   // Internet as % of all retailing
  { cdid: 'J5HW', datasetId: 'drsi' },   // All retailing deflator YoY %
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
  { cdid: 'KAB9', datasetId: 'lms' },    // AWE whole economy total pay level £ SA
  { cdid: 'KAC3', datasetId: 'lms' },    // AWE whole economy total pay 3m avg YoY % SA
  { cdid: 'A3WW', datasetId: 'lms' },    // AWE whole economy real total pay 3m YoY % SA

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
  { cdid: 'K23T', datasetId: 'diop' },   // Transport equipment CVMSA (replaces dead 'K230', verified 2026-07)
  { cdid: 'K232', datasetId: 'diop' },   // Other manufacturing

  // NOTE: former 'LPMB'/'LPMC' hpi entries removed 2026-07 — those CDIDs do not
  // exist on the ONS API (search returns NOT FOUND; they never populated rows).
  // UK house prices now come from the Land Registry UK HPI collector (ukHpi.ts).

  // ═══ UK Economic Data Models additions (2026-07, Phase 2) ═══
  // All CDIDs below verified live against the ONS search API (title + dataset).

  // ─── CPI Division Indices 01–12 (mm23, NSA) ───
  { cdid: 'D7BU', datasetId: 'mm23' },   // CPI INDEX 01 Food & non-alcoholic beverages
  { cdid: 'D7BV', datasetId: 'mm23' },   // CPI INDEX 02 Alcohol & tobacco
  { cdid: 'D7BW', datasetId: 'mm23' },   // CPI INDEX 03 Clothing & footwear
  { cdid: 'D7BX', datasetId: 'mm23' },   // CPI INDEX 04 Housing, water & fuels
  { cdid: 'D7BY', datasetId: 'mm23' },   // CPI INDEX 05 Furniture & HH equipment
  { cdid: 'D7BZ', datasetId: 'mm23' },   // CPI INDEX 06 Health
  { cdid: 'D7C2', datasetId: 'mm23' },   // CPI INDEX 07 Transport
  { cdid: 'D7C3', datasetId: 'mm23' },   // CPI INDEX 08 Communication
  { cdid: 'D7C4', datasetId: 'mm23' },   // CPI INDEX 09 Recreation & culture
  { cdid: 'D7C5', datasetId: 'mm23' },   // CPI INDEX 10 Education
  { cdid: 'D7C6', datasetId: 'mm23' },   // CPI INDEX 11 Hotels, cafes & restaurants
  { cdid: 'D7C7', datasetId: 'mm23' },   // CPI INDEX 12 Miscellaneous goods & services

  // ─── CPI Special Aggregate Indices (contribution model buckets) ───
  { cdid: 'D7F4', datasetId: 'mm23' },   // CPI INDEX: Goods
  { cdid: 'D7F5', datasetId: 'mm23' },   // CPI INDEX: Services
  { cdid: 'DK9T', datasetId: 'mm23' },   // CPI INDEX: Energy
  { cdid: 'DK9J', datasetId: 'mm23' },   // CPI INDEX: Non-energy industrial goods (core goods)
  { cdid: 'DK9O', datasetId: 'mm23' },   // CPI INDEX: Food, alcoholic beverages & tobacco

  // ─── CPI Division Weights 01–12 (parts per 1000) ───
  { cdid: 'CHZR', datasetId: 'mm23' },   // CPI WEIGHTS 01
  { cdid: 'CHZS', datasetId: 'mm23' },   // CPI WEIGHTS 02
  { cdid: 'CHZT', datasetId: 'mm23' },   // CPI WEIGHTS 03
  { cdid: 'CHZU', datasetId: 'mm23' },   // CPI WEIGHTS 04
  { cdid: 'CHZV', datasetId: 'mm23' },   // CPI WEIGHTS 05
  { cdid: 'CHZW', datasetId: 'mm23' },   // CPI WEIGHTS 06
  { cdid: 'CHZX', datasetId: 'mm23' },   // CPI WEIGHTS 07
  { cdid: 'CHZY', datasetId: 'mm23' },   // CPI WEIGHTS 08
  { cdid: 'CHZZ', datasetId: 'mm23' },   // CPI WEIGHTS 09
  { cdid: 'CJUU', datasetId: 'mm23' },   // CPI WEIGHTS 10
  { cdid: 'CJUV', datasetId: 'mm23' },   // CPI WEIGHTS 11
  { cdid: 'CJUW', datasetId: 'mm23' },   // CPI WEIGHTS 12

  // ─── CPI Special Aggregate Weights (contribution model) ───
  { cdid: 'A9EW', datasetId: 'mm23' },   // CPI wts: Food, alcoholic beverages & tobacco
  { cdid: 'A9F3', datasetId: 'mm23' },   // CPI wts: Energy
  { cdid: 'A9ER', datasetId: 'mm23' },   // CPI wts: Non-energy industrial goods
  { cdid: 'ICVI', datasetId: 'mm23' },   // CPI WEIGHTS: Services
  { cdid: 'ICVH', datasetId: 'mm23' },   // CPI WEIGHTS: Goods

  // ─── CPI Group-Level Indices XX.Y (distribution panel, 37 groups) ───
  { cdid: 'D7C8', datasetId: 'mm23' },   // 01.1 Food
  { cdid: 'D7C9', datasetId: 'mm23' },   // 01.2 Non-alcoholic beverages
  { cdid: 'D7CA', datasetId: 'mm23' },   // 02.1 Alcoholic beverages
  { cdid: 'D7CB', datasetId: 'mm23' },   // 02.2 Tobacco
  { cdid: 'D7CC', datasetId: 'mm23' },   // 03.1 Clothing
  { cdid: 'D7CD', datasetId: 'mm23' },   // 03.2 Footwear
  { cdid: 'D7CE', datasetId: 'mm23' },   // 04.1 Actual rents for housing
  { cdid: 'D7CF', datasetId: 'mm23' },   // 04.3 Maintenance & repair of dwelling
  { cdid: 'D7CG', datasetId: 'mm23' },   // 04.4 Water supply & misc dwelling services
  { cdid: 'D7CH', datasetId: 'mm23' },   // 04.5 Electricity, gas & other fuels
  { cdid: 'D7CI', datasetId: 'mm23' },   // 05.1 Furniture & furnishings
  { cdid: 'D7CJ', datasetId: 'mm23' },   // 05.2 Household textiles
  { cdid: 'D7CK', datasetId: 'mm23' },   // 05.3 Household appliances
  { cdid: 'D7CL', datasetId: 'mm23' },   // 05.4 Glassware & tableware
  { cdid: 'D7CM', datasetId: 'mm23' },   // 05.5 Tools & equipment
  { cdid: 'D7CN', datasetId: 'mm23' },   // 05.6 Routine maintenance goods/services
  { cdid: 'D7F6', datasetId: 'mm23' },   // 06.1 Medical products
  { cdid: 'D7F9', datasetId: 'mm23' },   // 06.2 Out-patient services
  { cdid: 'D7FC', datasetId: 'mm23' },   // 06.3 Hospital services
  { cdid: 'D7CO', datasetId: 'mm23' },   // 07.1 Purchase of vehicles
  { cdid: 'D7CP', datasetId: 'mm23' },   // 07.2 Operation of personal transport
  { cdid: 'D7CQ', datasetId: 'mm23' },   // 07.3 Transport services
  { cdid: 'D7CR', datasetId: 'mm23' },   // 08.1 Postal services
  { cdid: 'D7CS', datasetId: 'mm23' },   // 09.1 Audio-visual equipment
  { cdid: 'D7CT', datasetId: 'mm23' },   // 09.2 Other major durables for recreation
  { cdid: 'D7CU', datasetId: 'mm23' },   // 09.3 Other recreational items
  { cdid: 'D7CV', datasetId: 'mm23' },   // 09.4 Recreational & cultural services
  { cdid: 'D7FJ', datasetId: 'mm23' },   // 09.5 Books, newspapers & stationery
  { cdid: 'D7FN', datasetId: 'mm23' },   // 09.6 Package holidays
  { cdid: 'D7CW', datasetId: 'mm23' },   // 11.1 Catering services
  { cdid: 'D7CX', datasetId: 'mm23' },   // 11.2 Accommodation services
  { cdid: 'D7CY', datasetId: 'mm23' },   // 12.1 Personal care
  { cdid: 'D7FO', datasetId: 'mm23' },   // 12.3 Personal effects
  { cdid: 'D7D2', datasetId: 'mm23' },   // 12.4 Social protection
  { cdid: 'D7D3', datasetId: 'mm23' },   // 12.5 Insurance
  { cdid: 'D7D4', datasetId: 'mm23' },   // 12.6 Financial services
  { cdid: 'D7FR', datasetId: 'mm23' },   // 12.7 Other services

  // ─── CPI Rent (annual rate twin of D7CE) ───
  { cdid: 'D7GQ', datasetId: 'mm23' },   // CPI ANNUAL RATE 04.1 Actual rents

  // ─── PPI (post-2024-redesign codes; NSA) ───
  { cdid: 'JVZ8', datasetId: 'ppi' },    // Output: net sector all manufacturing ex duty
  { cdid: 'GBBV', datasetId: 'ppi' },    // Output: core manufactured products (ex food/bev/tob/petroleum)
  { cdid: 'GD6Y', datasetId: 'ppi' },    // Output total: manufactured products ex duty
  { cdid: 'K646', datasetId: 'ppi' },    // Input: NSI all manufacturing incl CCL
  { cdid: 'K645', datasetId: 'ppi' },    // Input: fuel purchased by manufacturing ex CCL
  { cdid: 'FSQ6', datasetId: 'ppi' },    // Input group: other inputs
  { cdid: 'FSQ7', datasetId: 'ppi' },    // Input group: chemicals
  { cdid: 'G6SN', datasetId: 'ppi' },    // Output domestic: C13 textiles
  { cdid: 'G8ZD', datasetId: 'ppi' },    // Output total: C13 textiles
  { cdid: 'G75I', datasetId: 'ppi' },    // Output domestic: C31 furniture
  { cdid: 'G942', datasetId: 'ppi' },    // Output total: C31 furniture

  // ─── Labour Market — LFS detail ───
  { cdid: 'YBUS', datasetId: 'lms' },    // Total actual weekly hours worked (millions) SA
  { cdid: 'BEAO', datasetId: 'lms' },    // Redundancy level 000s SA
  { cdid: 'MGXB', datasetId: 'lms' },    // Unemployment rate 25-49 SA %
  { cdid: 'YBVW', datasetId: 'lms' },    // Unemployment rate 50+ SA %
  { cdid: 'MGSF', datasetId: 'lms' },    // Economically active 16+ 000s SA
  { cdid: 'LF2K', datasetId: 'lms' },    // Economically active 16-64 000s SA
  { cdid: 'MGTS', datasetId: 'lms' },    // Economically active 16+ 000s NSA

  // ─── Labour Market — AWE (earn01) ───
  { cdid: 'KAI7', datasetId: 'lms' },    // AWE whole economy regular pay level £ SA
  { cdid: 'KAI9', datasetId: 'lms' },    // AWE whole economy regular pay 3m avg YoY % SA
  { cdid: 'KAF5', datasetId: 'lms' },    // AWE whole economy total pay single-month YoY % SA
  { cdid: 'A2FA', datasetId: 'lms' },    // AWE whole economy real regular pay 3m YoY % SA
  { cdid: 'K54U', datasetId: 'emp' },    // AWE whole economy index, total pay SA
  { cdid: 'K54L', datasetId: 'emp' },    // AWE whole economy index, regular pay SA
  { cdid: 'K553', datasetId: 'emp' },    // AWE construction index, total pay SA
  { cdid: 'K552', datasetId: 'emp' },    // AWE manufacturing index, total pay SA
  { cdid: 'K54X', datasetId: 'emp' },    // AWE service sector index, total pay SA
  { cdid: 'K54W', datasetId: 'emp' },    // AWE public sector index, total pay SA
  { cdid: 'K5DL', datasetId: 'emp' },    // AWE services level £, regular pay SA
  { cdid: 'K5DU', datasetId: 'emp' },    // AWE manufacturing level £, regular pay SA
  { cdid: 'K5DX', datasetId: 'emp' },    // AWE construction level £, regular pay SA

  // ─── Productivity & Unit Labour Costs (quarterly) ───
  { cdid: 'LZVB', datasetId: 'prdy' },   // Output per hour worked SA index
  { cdid: 'DMWN', datasetId: 'prdy' },   // ULC whole economy YoY % SA
  { cdid: 'DMWO', datasetId: 'prdy' },   // ULC whole economy QoQ % SA
  { cdid: 'LNNL', datasetId: 'ucst' },   // ULC whole economy index SA

  // ─── Household Income & Consumption (quarterly) ───
  { cdid: 'NRJR', datasetId: 'qna' },    // Real household disposable income CVM SA £m
  { cdid: 'IHXY', datasetId: 'ukea' },   // RHDI per head CVM NSA
  { cdid: 'KHI9', datasetId: 'qna' },    // RHDI annual growth rate SA %
  { cdid: 'DGD8', datasetId: 'ukea' },   // Households' saving ratio % SA
  { cdid: 'IHXM', datasetId: 'ukea' },   // Corporations' GOS as % of GDP SA
  { cdid: 'L8GG', datasetId: 'qna' },    // Implied GDP deflator SA index
  { cdid: 'UTID', datasetId: 'qna' },    // Consumer trends: durable goods CVM SA £m
  { cdid: 'UTIT', datasetId: 'ct' },     // Consumer trends: semi-durable goods CVM SA £m
  { cdid: 'UTIL', datasetId: 'qna' },    // Consumer trends: non-durable goods CVM SA £m
  { cdid: 'UTIP', datasetId: 'qna' },    // Consumer trends: services CVM SA £m

  // ─── Trade — Totals & Services (monthly, BoP basis) ───
  { cdid: 'IKBJ', datasetId: 'pnbp' },   // Total trade balance CP SA £m
  { cdid: 'IKBH', datasetId: 'pnbp' },   // Total trade exports CP SA £m
  { cdid: 'IKBI', datasetId: 'pnbp' },   // Total trade imports CP SA £m
  { cdid: 'IKBM', datasetId: 'mret' },   // Total trade balance CVM SA £m
  { cdid: 'IKBB', datasetId: 'mret' },   // Trade in services exports CP SA £m
  { cdid: 'IKBC', datasetId: 'qna' },    // Trade in services imports CP SA £m
  { cdid: 'IKBD', datasetId: 'mret' },   // Trade in services balance CP SA £m
  { cdid: 'IKBE', datasetId: 'mret' },   // Trade in services exports CVM SA £m
  { cdid: 'IKBF', datasetId: 'diop' },   // Trade in services imports CVM SA £m

  // ─── Public Sector Finances (pusf, monthly, NSA) ───
  { cdid: 'DZLS', datasetId: 'pusf' },   // PSNB ex banking groups £m
  { cdid: 'J5II', datasetId: 'pusf' },   // PSNB ex banking groups £m CPNSA (alt)
  { cdid: 'DZLT', datasetId: 'pusf' },   // PS current budget deficit ex £m
  { cdid: 'DZLW', datasetId: 'pusf' },   // PS net investment ex £m
  { cdid: 'HF6W', datasetId: 'pusf' },   // PSND ex £bn
  { cdid: 'HF6X', datasetId: 'pusf' },   // PSND ex % of GDP
  { cdid: 'RURQ', datasetId: 'pusf' },   // PS net cash requirement £m
  { cdid: 'RUUW', datasetId: 'pusf' },   // CG net cash requirement £m
  { cdid: 'AHHY', datasetId: 'pusf' },   // Total PS taxes & NICs receipts £m NSA
  { cdid: 'JNVA', datasetId: 'pusf' },   // PS borrowing inc banks as % GDP
  { cdid: 'JMEQ', datasetId: 'pusf' },   // PS gross debt ex £m
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
