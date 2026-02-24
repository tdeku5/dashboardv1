# FRED Series Lookup Skill

## Purpose
Look up, verify, and document FRED (Federal Reserve Economic Data) series codes accurately for any source — BLS, BEA, Census, Federal Reserve, and beyond. This skill prevents the most common failure mode: guessing or inferring series codes that turn out to be wrong, and documents the structural patterns needed to navigate FRED's 840,000+ series across 118 sources.

---

## Core Principle: Always Verify, Never Infer

**Never guess a FRED ticker.** There is no single consistent naming pattern across FRED. The same statistical agency may use completely different conventions across its own surveys (e.g. BLS uses named tickers for CPS unemployment rates, numeric CES codes for AHE, and AWHAEX-style named tickers for AWH — all in the same domain). Always search FRED directly and confirm the exact ticker before using it.

The only exception: series already in the verified tables at the bottom of this skill.

---

## Universal Lookup Methodology

### Step 1: Identify the Source Agency and Survey First
Before searching, establish:
- **Which agency publishes this?** BLS, BEA, Census, Fed, other?
- **Which specific survey or program?** CES, CPS, JOLTS, NIPA, CPI, PPI, etc.
- **What dimension is needed?** Level, rate, index, price, percent change?
- **SA or NSA?** These often have entirely different tickers, not just different suffixes.

This narrows the search and informs which naming patterns to expect.

### Step 2: Search FRED Using Natural Language
Search FRED using language that mirrors how the agency titles the series:

```
FRED "[exact concept name]" "[sector or geography]" site:fred.stlouisfed.org
```

Examples:
- `FRED "job openings" "construction" seasonally adjusted site:fred.stlouisfed.org`
- `FRED "housing starts" "total" seasonally adjusted site:fred.stlouisfed.org`
- `FRED "personal consumption expenditures" "motor vehicles" site:fred.stlouisfed.org`
- `FRED "producer price index" "final demand services" site:fred.stlouisfed.org`
- `FRED "owners equivalent rent" CPI site:fred.stlouisfed.org`

If the first search is ambiguous, add the source agency:
```
FRED "average weekly earnings" manufacturing "bureau of labor statistics" site:fred.stlouisfed.org
```

### Step 3: Use the FRED API Search as a Power Tool
When web search is inconclusive, the FRED API's `/fred/series/search` endpoint can search all 840,000+ series programmatically. This is the most reliable fallback for obscure or subcomponent series.

```
GET https://api.stlouisfed.org/fred/series/search
  ?search_text=owners+equivalent+rent
  &search_type=full_text
  &order_by=popularity
  &sort_order=desc
  &api_key={FRED_API_KEY}
  &file_type=json
```

Parameters:
- `search_text`: Natural language query (URL-encode spaces as `+`)
- `search_type`: `full_text` (searches title, units, frequency, tags) or `series_id` (substring match on ticker)
- `order_by`: `popularity` (most useful for finding the canonical series), `series_id`, `title`
- `filter_variable` / `filter_value`: Filter by `frequency`, `units`, or `seasonal_adjustment` to narrow results
- `exclude_tag_names=discontinued`: Skip discontinued series

Use this when: a series has an opaque ticker that won't surface easily in a web search; when looking for all variants of a concept at once; when building an automated verification step.

### Step 4: Confirm the Ticker
Look for any of these confirmation patterns in search results:

**Pattern A** — In series description notes (most reliable):
> "The source code is: TICKER"

**Pattern B** — In page title:
> `Series Name (TICKER) | FRED | St. Louis Fed`

**Pattern C** — In URL:
> `https://fred.stlouisfed.org/series/TICKER`

All available patterns must agree. If they don't, the page may be showing a related but different series.

### Step 5: Check Data Availability
Note these fields before finalizing:
- **observation_start**: When does the series begin? (Critical — some key subcomponents only start 2006 or later)
- **frequency**: Monthly, quarterly, annual, weekly, daily?
- **seasonal_adjustment**: SA or NSA?
- **units**: Thousands, millions, index, percent, dollars/hour?
- **Is it discontinued?** Look for "(DISCONTINUED)" in the title — always check whether a replacement series exists

### Step 6: Use the Sidebar to Find Related Series
Every FRED series page lists related series in the sidebar. This is the fastest way to find sibling series (e.g., once you have one CPI component, the sidebar lists the other major components). Always check the sidebar before running additional searches for the same survey.

### Step 7: Present for Verification
Before building anything, present the full list of proposed series to the user in a table:

| Series Name | FRED Code | Start Date | Frequency | SA/NSA | Units |
|------------|-----------|------------|-----------|--------|-------|

Never proceed without user confirmation when using new (non-pre-verified) series.

---

## Source-by-Source Guide and Naming Patterns

### BLS — Bureau of Labor Statistics

BLS is the largest single contributor to FRED. Each BLS program has a distinct naming convention — do not cross-assume patterns between them.

---

#### CES (Current Employment Statistics) — Establishment Survey
Covers nonfarm payrolls, average hourly earnings (AHE), average weekly hours (AWH), and average weekly earnings (AWE).

**Employment (All Employees):**
- Mix of legacy named tickers (PAYEMS, MANEMP, USPRIV) and numeric CES codes (CES4300000001)
- Numeric pattern for employment: `CES[supersector][industry group]000001`
  - Position 1–2: Supersector code (05=Total Private, 06=Goods, 08=Private Services, etc.)
  - Last 6 digits: `000001` for total employment in that sector
- **Caution**: Many employment series use named tickers, not numeric codes. Never infer numeric codes for employment without verifying.

**Average Hourly Earnings (AHE):**
- Always numeric CES pattern ending in `...000003`
- Example: CES0500000003 = Total Private AHE
- Government AHE: **Not published by BLS, not available on FRED**

**Average Weekly Hours (AWH):**
- **Never uses numeric CES codes** — always uses named AWHAE-prefix tickers
- Pattern: `AWHAEX[sector abbreviation]` (e.g., AWHAETP = Total Private, AWHAEMAN = Manufacturing)
- Start date: March 2006 for all sector-level AHE and AWH series

**Average Weekly Earnings (AWE):**
- Numeric CES pattern ending in `...000011`
- Example: CES0500000011 = Total Private AWE

---

#### CPS (Current Population Survey) — Household Survey
Covers unemployment rates, labor force participation, employment levels, and demographic breakdowns.

**Naming conventions:**
- Headline series: Named tickers (UNRATE, CIVPART, EMRATIO, CLF16OV)
- Demographic/subgroup series: LNS-prefix with 8-digit code
  - LNS1 = LFPR, LNS12 = Employed, LNS13 = Unemployed level, LNS14 = Unemployment rate
  - Next digits encode age/sex/race demographics
  - Example: LNS14000060 = Unemployment rate, 25–54 years
- U-rate alternatives: Named U1RATE through U6RATE

**Start dates:** Headline series 1948; demographic breakdowns often 1976 (when CPS expanded)

---

#### JOLTS (Job Openings and Labor Turnover Survey)
Covers job openings, hires, quits, layoffs and discharges, and total separations.

**Naming pattern:** `JTS[NAICS industry code][flow code]`

NAICS sector codes used in JOLTS:
- Total Nonfarm: (no sector code, use JTSJOL, JTSHIL, etc.)
- Construction: `2300`
- Manufacturing: `3000`
- Trade/Trans/Util: `4000`
- Retail Trade: `4400`
- Professional & Business Services: `540099`
- Education & Health: `6500`
- Leisure & Hospitality: `7000`
- Government: `9000`

Flow codes appended after the NAICS code:
- `JOL` = Job Openings Level (SA)
- `JOR` = Job Openings Rate (SA)
- `HIL` = Hires Level (SA)
- `HIR` = Hires Rate (SA)
- `QUL` = Quits Level (SA)
- `QUR` = Quits Rate (SA)
- `LDL` = Layoffs & Discharges Level (SA)
- `LDR` = Layoffs & Discharges Rate (SA)
- `TSL` = Total Separations Level (SA)
- `TSR` = Total Separations Rate (SA)

Total Nonfarm uses JTS prefix without a sector code: `JTSJOL`, `JTSHIL`, `JTSQUL`, `JTSLAL`, `JTSTSL`

Sector-level examples:
- Job openings, manufacturing: `JTS3000JOL`
- Quit rate, retail trade: `JTS4400QUR`
- Hires, professional services: `JTS540099HIL`

NSA variants replace the leading `JTS` with `JTU` for most sector series.

**Start date:** December 2000 for all JOLTS series

---

#### CPI (Consumer Price Index)
Covers consumer prices for urban households. The CPI is the primary US inflation measure for financial markets.

**Naming conventions — two parallel systems:**
The BLS issues CPI series in two formats on FRED:

1. **CUSR0000 + BLS item code** (Seasonally Adjusted): e.g., `CUSR0000SAH1` = Shelter SA
2. **CUUR0000 + BLS item code** (Not Seasonally Adjusted): e.g., `CUUR0000SAH1` = Shelter NSA

The `CPI...SL` named tickers (CPIAUCSL, CPILFESL) are SA shorthand tickers for major aggregates only — subcomponents generally use the CUSR/CUUR long-form codes.

**BLS item codes for major CPI components:**

Top-level:
- SA0 = All Items
- SA0L1 = All Items Less Food
- SA0L2 = All Items Less Shelter
- SA0L5 = All Items Less Medical Care
- SA0LE = All Items Less Food & Energy (Core)

Food:
- SAF = Food
- SAF1 = Food at Home
- SAF11 = Cereals & Bakery
- SAF116 = Dairy & Related
- SEFV = Food Away from Home

Energy:
- SAE = Energy
- SAE1 = Energy Commodities
- SETB01 = Gasoline (All Types)
- SACE = Energy Services

Shelter:
- SAH1 = Shelter
- SAH11 = Rent of Primary Residence
- SEHC = Owners' Equivalent Rent (OER) ← most important
- SEHC01 = OER of Primary Residence

Transportation:
- SAT = Transportation
- SETA = New & Used Motor Vehicles
- SETA01 = New Vehicles
- SETA02 = Used Cars & Trucks
- SAS4 = Transportation Services
- SETB = Motor Fuel

Medical Care:
- SAM = Medical Care
- SAM1 = Medical Care Commodities
- SAM2 = Medical Care Services (physicians, hospitals)

Other:
- SAA = Apparel
- SAR = Recreation
- SAE2 = Education & Communication
- SASL2RS = Services Less Rent of Shelter ("Supercore")

Examples: CUSR0000SEHC = OER (SA), CUSR0000SETA02 = Used Cars & Trucks (SA)

**Start dates:** Headline 1947; Core (SA0LE) 1957; OER (SEHC) Jan 1983; most components 1947–1967

---

#### PPI (Producer Price Index)
Covers prices received by domestic producers at various stages of production.

**Series structure — two naming approaches:**
1. **Final Demand series** (current framework, from 2010): PPIFIS, PPIFGS, PPIFSS, etc.
2. **Commodity-based series** (long history to 1913): PPIACO and WPUXX codes

**Final Demand structure:**
- PPIFIS = PPI Final Demand (headline, all items) — preferred for current analysis
- PPIFGS = PPI Final Demand: Goods
- PPIFSS = PPI Final Demand: Services
- PPIFTS = PPI Final Demand: Transportation & Warehousing
- WPSFD4131 = PPI Final Demand: Construction

**Commodity codes** (WPU prefix = Wholesale Price/PPI by Commodity):
- PPIACO = PPI All Commodities (starts 1913, old methodology)
- WPU101 = Farm Products
- WPU061 = Crude Petroleum
- WPU102 = Processed Foods

**Key rule:** PPIFIS replaced PPIACO as the headline PPI measure in 2014. Use PPIFIS for current analysis. Use PPIACO only for long historical series (starts 1913).

---

#### ECI (Employment Cost Index)
Covers total compensation including wages, salaries, and benefits.

- ECIALLCIV = Total Compensation, Civilian Workers (SA, quarterly, starts 1979)
- ECIWAG = Wages & Salaries, Civilian Workers (SA, quarterly)
- Series also available by sector (private vs. government) and occupation

---

#### Productivity & Costs (BLS)
- OPHNFB = Output Per Hour, Nonfarm Business (quarterly, SA)
- ULCNFB = Unit Labor Costs, Nonfarm Business (quarterly, SA)
- PRS85006092 = Nonfarm Business: Real Output per Hour (alternative format)

---

### BEA — Bureau of Economic Analysis

BEA series on FRED are identified by a **BEA Account Code** in the series notes field (e.g., "BEA Account Code: A191RC"). **The FRED ticker bears absolutely no systematic relation to this code.** Always search by series description, not by account code.

**BEA long-form tickers** follow a pattern: `[BEA code][frequency][units code][SBEA]`
- Example: `A191RL1Q225SBEA` = Real GDP, percent change, quarterly, SAAR
- Example: `DPCERA3M086SBEA` = Real PCE, chained 2017 dollars, monthly, SA

These long-form codes are hard to infer — always search rather than construct.

---

#### NIPA — GDP and Expenditure Components
- GDP = Nominal GDP (quarterly, SAAR, starts 1947)
- GDPC1 = Real GDP (chained 2017 dollars, quarterly, SAAR)
- A191RL1Q225SBEA = Real GDP growth rate (%)
- GDPDEF = GDP Implicit Price Deflator
- GNP = Nominal GNP
- GNPC96 = Real GNP

GDP subcomponents — use natural language search with NIPA table reference:
- PCE = Nominal Personal Consumption Expenditures
- DPCERA3M086SBEA = Real PCE (monthly)
- PCES = PCE: Services
- PCEDG = PCE: Durable Goods
- PCEND = PCE: Nondurable Goods
- GPDI = Gross Private Domestic Investment
- PRFI = Private Residential Fixed Investment
- PNFI = Private Nonresidential Fixed Investment
- GCE = Government Consumption & Gross Investment
- NETEXP = Net Exports of Goods & Services

---

#### PCE Price Indexes
- PCEPI = PCE Price Index (headline, monthly SA)
- PCEPILFE = PCE Price Index Less Food & Energy (Core PCE — the Fed's preferred inflation measure)
- DDURRG3M086SBEA = PCE: Durable Goods Price Index
- DNDGRG3M086SBEA = PCE: Nondurable Goods Price Index
- DSERRG3M086SBEA = PCE: Services Price Index
- DHLCRG3Q086SBEA = PCE: Housing Price Index (quarterly)
- DHCGRG3Q086SBEA = PCE: Health Care Price Index (quarterly)

---

#### Personal Income & Savings
- PI = Personal Income (monthly, SAAR)
- RPI = Real Personal Income
- DSPI = Disposable Personal Income
- DSPIC96 = Real Disposable Personal Income
- PSAVERT = Personal Saving Rate (%)

---

#### Corporate Profits, Investment
- CP = Corporate Profits After Tax (quarterly)
- CPATAX = Corporate Profits After Tax with IVA and CCAdj
- GPDI = Gross Private Domestic Investment
- PRFI = Private Residential Fixed Investment
- PNFI = Private Nonresidential Fixed Investment

---

### Census Bureau

Census series on FRED typically use descriptive named tickers. The Census Bureau covers housing, trade, manufacturing, and population.

---

#### Housing Construction (Census / HUD)
- HOUST = Housing Starts: Total (SA, monthly, starts 1959)
- HOUSTNSA = Housing Starts: Total (NSA)
- HOUSTE = Housing Starts: 1-Unit Structures (SA)
- HOUSTMW, HOUSTNE, HOUSTS, HOUSTW = Starts by region (Midwest, Northeast, South, West)
- PERMIT = New Private Housing Units Authorized (SA)
- PERMITNSA = Building Permits (NSA)
- UNDCONTSA = Housing Units Under Construction (SA)

---

#### Home Sales & Prices
- HSN1F = New Single-Family Home Sales (SA, starts 1963)
- MSPUS = Median Sales Price of Houses Sold (quarterly, NSA)
- ASPUS = Average Sales Price of Houses Sold
- RHORUSQ156N = Homeownership Rate (quarterly)
- ETOTALUSQ176N = Total Housing Inventory (quarterly)

---

#### Retail Trade & E-Commerce
- RSXFS = Advance Retail Sales: Retail & Food Services ex-Autos (most-watched, monthly SA)
- MRTSSM44000USS = Retail Sales: Total (monthly SA)
- MRTSSM44W72USS = Retail Sales & Food Services (monthly SA)
- ECOMSA = E-Commerce Retail Sales (quarterly SA)

---

#### Manufacturing (Durable Goods)
- DGORDER = Manufacturers' New Orders: Durable Goods (monthly SA, starts 1992)
- AMTMNO = Manufacturers' New Orders: Total Manufacturing (monthly SA)
- NEWORDER = Manufacturers' New Orders: Nondefense Capital Goods ex-Aircraft (monthly SA)
- ADXTNO = Manufacturers' New Orders: Defense Capital Goods (monthly SA)
- UMTMVS = Manufacturers' Unfilled Orders: Durable Goods (monthly SA)

---

### Federal Reserve System

Federal Reserve data covers interest rates, money supply, banking, financial conditions, and exchange rates.

---

#### Policy & Short Rates
- FEDFUNDS = Federal Funds Effective Rate (monthly average)
- DFF = Federal Funds Effective Rate (daily)
- DFEDTAR = FOMC Target Rate (daily, discontinued after adoption of target range)
- DFEDTARL / DFEDTARU = FOMC Target Rate Lower/Upper Bound (daily)
- IOER = Interest Rate on Excess Reserves (discontinued Nov 2021)
- IORB = Interest Rate on Reserve Balances (current, replaces IOER)

---

#### Treasury Yields
Monthly averages:
- GS1M = 1-Month Treasury
- GS3M = 3-Month Treasury (also TB3MS for discount basis)
- GS6M = 6-Month Treasury
- GS1 = 1-Year Treasury
- GS2 = 2-Year Treasury
- GS5 = 5-Year Treasury
- GS10 = 10-Year Treasury
- GS20 = 20-Year Treasury
- GS30 = 30-Year Treasury

Daily:
- DGS1M, DGS3M, DGS6M, DGS1, DGS2, DGS5, DGS10, DGS20, DGS30

**Inflation-Linked (TIPS):**
- DFII5, DFII7, DFII10, DFII20, DFII30 = Real yields at 5/7/10/20/30 year (daily)

**Breakeven Rates:**
- T5YIE = 5-Year Breakeven Inflation Rate (daily)
- T10YIE = 10-Year Breakeven Inflation Rate (daily)
- T5YIFR = 5-Year/5-Year Forward Breakeven Rate

**Spreads:**
- T10Y2Y = 10-Year minus 2-Year Treasury Spread (daily)
- T10Y3M = 10-Year minus 3-Month Treasury Spread (daily)
- BAA10Y = Moody's Baa Corporate minus 10-Year Treasury Spread

---

#### Money Supply & Reserves
- M1SL = M1 Money Stock (monthly SA)
- M2SL = M2 Money Stock (monthly SA)
- BOGMBASE = Monetary Base; Total (not seasonally adjusted)
- WRESBAL = Reserve Balances with Federal Reserve Banks (weekly)
- **MZMSL (MZM) discontinued May 2021 — use M2SL as replacement**

---

#### Credit & Banking
- BAMLH0A0HYM2 = ICE BofA US High Yield OAS Spread (daily)
- BAMLC0A0CM = ICE BofA US Corporate (Investment Grade) OAS Spread (daily)
- BAMLC0A4CBBB = ICE BofA BBB Spread (daily)
- TOTLL = Total Loans & Leases, Commercial Banks (weekly SA)
- DRCCLACBS = Delinquency Rate on Credit Card Loans (quarterly)
- DRSFRMACBS = Delinquency Rate on Single-Family Residential Mortgages (quarterly)
- CONSUMER = Consumer Credit Outstanding (monthly SA)

---

#### Exchange Rates
Broad indices:
- DTWEXBGS = Trade-Weighted USD Index: Broad, Goods (daily) ← best DXY proxy on FRED
- DTWEXAFEGS = Trade-Weighted USD Index: Advanced Foreign Economies (daily)
- DTWEXEMEGS = Trade-Weighted USD Index: Emerging Market Economies (daily)

Bilateral (daily, all DEX-prefix):
- DEXUSEU = USD per EUR
- DEXJPUS = JPY per USD
- DEXUSUK = USD per GBP
- DEXCAUS = CAD per USD
- DEXCHUS = CNY per USD
- DEXKOUS = KRW per USD
- DEXMXUS = MXN per USD
- DEXBZUS = BRL per USD

---

#### Industrial Production & Capacity (Federal Reserve Board)
- INDPRO = Industrial Production Index: Total (monthly SA, starts 1919)
- IPMAN = Industrial Production: Manufacturing (monthly SA)
- IPDMAN = Industrial Production: Durable Manufacturing
- IPNMAN = Industrial Production: Nondurable Manufacturing
- IPMINE = Industrial Production: Mining
- IPUTIL = Industrial Production: Utilities
- CAPUTLB00004SQ = Capacity Utilization: Total Industry (monthly SA)
- CUMFNS = Capacity Utilization: Manufacturing (monthly SA)

---

### Other Key Sources

#### Housing Prices (Non-Census)

**S&P Case-Shiller (copyrighted — pre-approval required for commercial use):**
- CSUSHPINSA = National Home Price Index (NSA, monthly)
- CSUSHPISA = National Home Price Index (SA, monthly)
- CS20RPSNSA = 20-City Composite (NSA)
- CS10RPSNSA = 10-City Composite (NSA)
- City-level: e.g., BOXRSA = Boston SA, SFXRSA = San Francisco SA

**FHFA:**
- USSTHPI = All-Transactions HPI (quarterly NSA)
- HPIPONM226S = Purchase-Only HPI (monthly SA)

**Freddie Mac:**
- MORTGAGE30US = 30-Year Fixed Rate Mortgage Average (weekly)
- MORTGAGE15US = 15-Year Fixed Rate Mortgage Average (weekly)

---

#### Commodities & Energy
- DCOILWTICO = WTI Crude Oil Price (daily)
- DCOILBRENTEU = Brent Crude Oil Price (daily)
- GASDESW = US Regular Gasoline Retail Price (weekly)
- GOLDPMGBD228NLBM = Gold Price: London PM Fix (daily)
- PPIACO = PPI All Commodities (monthly, starts 1913)

---

#### Fiscal / Treasury
- GFDEBTN = Federal Debt: Total Public Debt (quarterly)
- GFDEGDQ188S = Federal Debt as % of GDP (quarterly)
- FYFSRVN = Federal Budget Surplus or Deficit (annual)
- FGRECPT = Federal Receipts: Current (quarterly)
- FGEXPND = Federal Expenditures: Current (quarterly)
- W068RCQ027SBEA = Federal Government: Total Expenditures as % of GDP

---

#### Survey-Based / Sentiment
- UMCSENT = University of Michigan Consumer Sentiment (monthly)
- MICH = Michigan Inflation Expectations (monthly)
- CSCICP03USM665S = OECD Consumer Confidence for US
- STLFSI2 = St. Louis Fed Financial Stress Index (weekly)
- NFCI = Chicago Fed National Financial Conditions Index (weekly)

---

#### NBER / Academic
- USREC = NBER US Recession Indicator (monthly, 0/1)
- USRECM = NBER Recession Dates: Monthly (monthly)
- NROU = Natural Rate of Unemployment (quarterly, CBO estimate)
- GDPPOT = Real Potential GDP (quarterly)

---

## Suffix & Modifier Conventions

Understanding these patterns avoids pulling the wrong variant of a series:

| Suffix / Pattern | Meaning |
|-----------------|---------|
| `SL` at end | Seasonally Adjusted (BLS CPI convention, e.g. CPIAUCSL) |
| `NSA` | Not Seasonally Adjusted |
| `SA` | Seasonally Adjusted |
| `NSA` | Not Seasonally Adjusted |
| `Q225SBEA` | Quarterly SAAR, BEA source (in long-form BEA tickers) |
| `3M086SBEA` | Monthly, BEA chain-type price index |
| `A086SBEA` | Annual, BEA |
| `C1` or `C96` | Chained dollars (real), e.g. GDPC1 |
| `RX` or `RC` | Real, chained (BEA convention) |
| `RL1` | Real, percent change from preceding period |
| `PC1` | Per capita, chained |
| `D` prefix | Daily frequency (e.g. DFF, DGS10) |
| `W` prefix or suffix | Weekly |
| `156N` or `156S` | OECD international harmonized series (NSA or SA) |
| `USS` in Census codes | US total, seasonally adjusted |
| `CUSR0000` prefix | CPI SA, US City Average (BLS long-form) |
| `CUUR0000` prefix | CPI NSA, US City Average (BLS long-form) |
| `JTS` prefix | JOLTS SA series |
| `JTU` prefix | JOLTS NSA series |
| `LNS1` | CPS LFPR |
| `LNS12` | CPS Employment level |
| `LNS13` | CPS Unemployment level |
| `LNS14` | CPS Unemployment rate |

---

## Common Mistakes to Avoid

1. **Never infer AWH tickers from CES numeric patterns** — AWH uses named tickers (AWHAETP), never CES numeric codes
2. **SA and NSA are usually different tickers entirely** — don't assume adding/removing a suffix works (ICSA ≠ ICNSA is fine, but many series differ more dramatically)
3. **BEA Account Codes ≠ FRED tickers** — "BEA Account Code: A191RC" in the series notes does NOT mean the FRED ticker is A191RC
4. **Check for discontinued series before using** — MZMSL (money supply), PPIACO as headline, DFEDTAR (pre-rate-range), IOER (replaced by IORB), and many older BEA/Census series have been superseded
5. **One concept, many variants** — FRED often has multiple versions: vintages, geographies, frequencies, seasonal adjustment methods. Check the sidebar to see all variants and confirm which one you need
6. **Copyrighted data requires pre-approval** — S&P/Case-Shiller, Dow Jones, Moody's, ICE BofA series on FRED carry copyright. Verify terms before commercial use
7. **BLS CPI has two parallel long-form ticker systems** — CUSR = SA, CUUR = NSA, both for the same US City Average series
8. **JOLTS NSA uses JTU prefix, not JTS** — e.g., JTU3000JOL is manufacturing openings NSA

---

## Using the FRED API for Verification (When Web Search Fails)

When you have the project's FRED API key available, this script verifies a proposed series ID and returns its metadata:

```typescript
async function verifyFREDSeries(seriesId: string): Promise<void> {
  const url = `https://api.stlouisfed.org/fred/series?series_id=${seriesId}&api_key=${process.env.FRED_API_KEY}&file_type=json`;
  const response = await fetch(url);
  const data = await response.json();
  const s = data.seriess?.[0];
  if (!s) { console.error(`Series ${seriesId} not found`); return; }
  console.log({
    id: s.id,
    title: s.title,
    start: s.observation_start,
    end: s.observation_end,
    frequency: s.frequency,
    units: s.units,
    seasonal_adjustment: s.seasonal_adjustment,
    notes: s.notes?.substring(0, 200)
  });
}
```

To search for series by text:
```typescript
async function searchFREDSeries(searchText: string): Promise<void> {
  const encoded = encodeURIComponent(searchText);
  const url = `https://api.stlouisfed.org/fred/series/search?search_text=${encoded}&order_by=popularity&sort_order=desc&api_key=${process.env.FRED_API_KEY}&file_type=json`;
  const response = await fetch(url);
  const data = await response.json();
  data.seriess?.slice(0, 10).forEach((s: any) => {
    console.log(`${s.id} | ${s.title} | ${s.frequency} | ${s.seasonal_adjustment} | starts ${s.observation_start}`);
  });
}
```

---

## Verified Series Reference Tables

### CES — Employment (All Employees, SA)
| Sector | FRED Code |
|--------|-----------|
| Total Nonfarm | PAYEMS |
| Total Private | USPRIV |
| Goods Producing | USGOOD |
| Mining & Logging | USMINE |
| Construction | USCONS |
| Manufacturing | MANEMP |
| Service Providing | SRVPRD |
| Private Service Providing | CES0800000001 |
| Trade, Transportation & Utilities | USTPU |
| Wholesale Trade | USWTRADE |
| Retail Trade | USTRADE |
| Transportation & Warehousing | CES4300000001 |
| Utilities | CES4422000001 |
| Information | USINFO |
| Financial Activities | USFIRE |
| Professional & Business Services | USPBS |
| Education & Health Services | USEHS |
| Leisure & Hospitality | USLAH |
| Other Services | USSERV |
| Government | USGOVT |
| Federal | CES9091000001 |
| State | CES9092000001 |
| Local | CES9093000001 |

### CES — Average Hourly Earnings (All Employees, SA, starts March 2006)
| Sector | FRED Code |
|--------|-----------|
| Total Private | CES0500000003 |
| Goods Producing | CES0600000003 |
| Private Service Providing | CES0800000003 |
| Mining & Logging | CES1000000003 |
| Construction | CES2000000003 |
| Manufacturing | CES3000000003 |
| Trade, Transportation & Utilities | CES4000000003 |
| Wholesale Trade | CES4142000003 |
| Retail Trade | CES4200000003 |
| Transportation & Warehousing | CES4300000003 |
| Utilities | CES4422000003 |
| Information | CES5000000003 |
| Financial Activities | CES5500000003 |
| Professional & Business Services | CES6000000003 |
| Education & Health Services | CES6500000003 |
| Leisure & Hospitality | CES7000000003 |
| Other Services | CES8000000003 |
| Government | Not available on FRED |

### CES — Average Weekly Hours (All Employees, SA, starts March 2006)
| Sector | FRED Code |
|--------|-----------|
| Total Private | AWHAETP |
| Goods Producing | AWHAEGP |
| Private Service Providing | AWHAEPSP |
| Mining & Logging | AWHAEMAL |
| Construction | AWHAECON |
| Manufacturing | AWHAEMAN |
| Trade, Transportation & Utilities | AWHAETTU |
| Wholesale Trade | AWHAEWT |
| Retail Trade | AWHAERT |
| Transportation & Warehousing | AWHAETAW |
| Utilities | AWHAEUTIL |
| Information | AWHAEINFO |
| Financial Activities | AWHAEFA |
| Professional & Business Services | AWHAEPBS |
| Education & Health Services | AWHAEEHS |
| Leisure & Hospitality | AWHAELAH |
| Other Services | AWHAEOS |

### CPS — Labor Market
| Series | FRED Code |
|--------|-----------|
| Unemployment Rate (U-3) | UNRATE |
| U-1 Rate | U1RATE |
| U-2 Rate | U2RATE |
| U-4 Rate | U4RATE |
| U-5 Rate | U5RATE |
| U-6 Rate | U6RATE |
| Unemployment Level | UNEMPLOY |
| Civilian Labor Force | CLF16OV |
| Employment Level | CE16OV |
| Employment-Population Ratio | EMRATIO |
| LFPR Overall | CIVPART |
| LFPR 25–54 | LNS11300060 |
| EPOP 25–54 | LNS12300060 |
| Unemployment Rate 16–24 | LNS14024887 |
| Unemployment Rate 25–54 | LNS14000060 |
| Unemployment Rate 55–64 | LNU04000095 |
| Permanent Layoffs | LNS13026638 |
| Reentrants | LNS13023557 |
| New Entrants | LNS13023569 |
| Job Leavers | LNS13023705 |
| Completed Temporary Jobs | LNS13026637 |
| Temporary Layoffs | LNS13023653 |

### Claims
| Series | FRED Code |
|--------|-----------|
| Initial Claims SA | ICSA |
| Initial Claims NSA | ICNSA |
| Continuing Claims SA | CCSA |
| Continuing Claims NSA | CCNSA |

### JOLTS — Total Nonfarm (SA)
| Series | FRED Code |
|--------|-----------|
| Job Openings Level | JTSJOL |
| Job Openings Rate | JTSJOR |
| Hires Level | JTSHIL |
| Hires Rate | JTSHIR |
| Quits Level | JTSQUL |
| Quits Rate | JTSQUR |
| Layoffs & Discharges Level | JTSLAL |
| Layoffs & Discharges Rate | JTSLDR |
| Total Separations Level | JTSTSL |
| Total Separations Rate | JTSTSR |

### CPI — Key Aggregates and Components (SA unless noted)
| Series | FRED Code | Starts |
|--------|-----------|--------|
| All Items (SA) | CPIAUCSL | 1947 |
| Core (Less Food & Energy) SA | CPILFESL | 1957 |
| Food (SA) | CPIUFDSL | 1967 |
| Energy (SA) | CPIENGSL | 1957 |
| Shelter (SA) | CUSR0000SAH1 | 1953 |
| Rent of Primary Residence (SA) | CUSR0000SAH11 | 1983 |
| Owners' Equivalent Rent (SA) | CUSR0000SEHC | 1983 |
| Services Less Rent of Shelter (SA, "Supercore") | CUSR0000SASL2RS | 1985 |
| New Vehicles (SA) | CUSR0000SETA01 | 1953 |
| Used Cars & Trucks (SA) | CUSR0000SETA02 | 1953 |
| Transportation Services (SA) | CUSR0000SAS4 | 1956 |
| Medical Care Services (SA) | CUSR0000SAM2 | 1956 |
| Apparel (SA) | CPIAPPSL | 1947 |

### PCE Price Indexes
| Series | FRED Code |
|--------|-----------|
| PCE Price Index (headline) | PCEPI |
| Core PCE (Less Food & Energy) | PCEPILFE |
| PCE: Durable Goods | DDURRG3M086SBEA |
| PCE: Nondurable Goods | DNDGRG3M086SBEA |
| PCE: Services | DSERRG3M086SBEA |

### National Accounts (BEA)
| Series | FRED Code |
|--------|-----------|
| Nominal GDP | GDP |
| Real GDP | GDPC1 |
| Real GDP Growth Rate (%) | A191RL1Q225SBEA |
| GDP Deflator | GDPDEF |
| Nominal PCE | PCE |
| Real PCE (monthly) | DPCERA3M086SBEA |
| PCE: Durable Goods | PCEDG |
| PCE: Nondurable Goods | PCEND |
| PCE: Services | PCES |
| Real Personal Income | RPI |
| Disposable Personal Income | DSPI |
| Personal Saving Rate | PSAVERT |
| Gross Private Domestic Investment | GPDI |
| Private Residential Fixed Investment | PRFI |
| Corporate Profits After Tax | CP |

### Activity & Industry
| Series | FRED Code |
|--------|-----------|
| Industrial Production: Total | INDPRO |
| Industrial Production: Manufacturing | IPMAN |
| Capacity Utilization: Total | CAPUTLB00004SQ |
| Capacity Utilization: Manufacturing | CUMFNS |
| Durable Goods Orders | DGORDER |
| Core Capital Goods Orders (ex-defense, ex-aircraft) | NEWORDER |
| Retail Sales ex-Autos | RSXFS |

### Housing
| Series | FRED Code |
|--------|-----------|
| Housing Starts Total SA | HOUST |
| Housing Starts Total NSA | HOUSTNSA |
| Housing Starts Single-Family SA | HOUSTE |
| Building Permits SA | PERMIT |
| New Home Sales SA | HSN1F |
| Median Home Sales Price | MSPUS |
| Homeownership Rate | RHORUSQ156N |
| Case-Shiller National HPI NSA ⚠️ | CSUSHPINSA |
| Case-Shiller National HPI SA ⚠️ | CSUSHPISA |
| FHFA HPI (purchase-only, monthly SA) | HPIPONM226S |
| 30-Year Mortgage Rate | MORTGAGE30US |
| 15-Year Mortgage Rate | MORTGAGE15US |

⚠️ Copyrighted — requires pre-approval for commercial use

### Financial & Monetary
| Series | FRED Code |
|--------|-----------|
| Fed Funds Rate (monthly) | FEDFUNDS |
| Fed Funds Rate (daily) | DFF |
| FOMC Target Lower Bound | DFEDTARL |
| FOMC Target Upper Bound | DFEDTARU |
| Reserve Balances at Fed | WRESBAL |
| 2-Year Treasury (monthly) | GS2 |
| 10-Year Treasury (monthly) | GS10 |
| 30-Year Treasury (monthly) | GS30 |
| 10-Year TIPS Real Yield (daily) | DFII10 |
| 10Y-2Y Spread (daily) | T10Y2Y |
| 10Y-3M Spread (daily) | T10Y3M |
| 10Y Breakeven Inflation (daily) | T10YIE |
| 5Y/5Y Forward Breakeven (daily) | T5YIFR |
| M1 Money Stock | M1SL |
| M2 Money Stock | M2SL |
| HY Credit Spread OAS (daily) | BAMLH0A0HYM2 |
| IG Credit Spread OAS (daily) | BAMLC0A0CM |
| Trade-Weighted USD Broad (DXY proxy, daily) | DTWEXBGS |

### Fiscal
| Series | FRED Code |
|--------|-----------|
| Federal Debt: Total Public | GFDEBTN |
| Federal Debt as % of GDP | GFDEGDQ188S |
| Federal Surplus or Deficit | FYFSRVN |
| Federal Receipts | FGRECPT |
| Federal Expenditures | FGEXPND |

---

## International Data on FRED

Many international series are available directly on FRED using country code prefixes or suffixes. Naming is inconsistent — always search.

**Common patterns:**
- OECD harmonized unemployment: `LRHUTTTT[ISO3]156S` (SA) or `156N` (NSA)
  - Example: LRHUTTTTDEM156S = Germany unemployment rate (SA)
  - Example: LRHUTTTTGBM156S = UK unemployment rate (SA)
- OECD CPI: `CP0000[ISO3]A` for annual, `M` for monthly
- Country codes: DEU = Germany, GBR = UK, JPN = Japan, CAN = Canada, FRA = France, ITA = Italy, AUS = Australia, CHN = China

**When FRED doesn't have the series, go directly to the primary source:**
| Region/Country | Source | API |
|----------------|--------|-----|
| EU / Eurozone | Eurostat | `ec.europa.eu/eurostat/api/dissemination` |
| UK | ONS | `api.ons.gov.uk` |
| Canada | Statistics Canada | `www150.statcan.gc.ca/t1/tbl1/en/tv.action` |
| Japan | e-Stat | `api.e-stat.go.jp` |
| Australia | ABS | `api.data.abs.gov.au` |
| OECD broad | OECD Data | `data.oecd.org` |
| IMF | IMF Data | `imf.org/en/Data` |
| World Bank | WDI | `api.worldbank.org/v2` |
