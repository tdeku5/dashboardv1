import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/globals.css'
import { Dashboard } from './Dashboard'
import { ModelsPage } from './pages/ModelsPage'
import { LaborMarketPage }  from './pages/LaborMarketPage'
import { LaborModelsPage }  from './pages/LaborModelsPage'
import { CPSDashboardPage }    from './pages/CPSDashboardPage'
import { ClaimsDashboardPage } from './pages/ClaimsDashboardPage'
import { CESDashboardPage }    from './pages/CESDashboardPage'
import { JOLTSDashboardPage }  from './pages/JOLTSDashboardPage'
import { ProductivityPage }      from './pages/ProductivityPage'
import { InflationPage }         from './pages/InflationPage'
import { CPIDashboardPage }      from './pages/CPIDashboardPage'
import { CPIProjectionsPage }   from './pages/CPIProjectionsPage'
import { PCEDashboardPage }    from './pages/PCEDashboardPage'
import { PCEProjectionsPage }  from './pages/PCEProjectionsPage'
import { PPIDashboardPage }    from './pages/PPIDashboardPage'
import { NewsAggregatorPage }        from './pages/NewsAggregatorPage'
import { TreasuryAuctionPage }      from './pages/TreasuryAuctionPage'
import { OtherInflationPage }      from './pages/OtherInflationPage'
import { FiscalFlowsPage }         from './pages/FiscalFlowsPage'
import { GrowthPage }              from './pages/GrowthPage'
import { NGDPDashboardPage }       from './pages/NGDPDashboardPage'
import { RGDPDashboardPage }      from './pages/RGDPDashboardPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                             element={<Dashboard />} />
        <Route path="/models"                       element={<ModelsPage />} />
        <Route path="/models/labor"                 element={<LaborMarketPage />} />
        <Route path="/models/labor/projection"      element={<LaborModelsPage />} />
        <Route path="/models/labor/cps"             element={<CPSDashboardPage />} />
        <Route path="/models/labor/claims"          element={<ClaimsDashboardPage />} />
        <Route path="/models/labor/ces"             element={<CESDashboardPage />} />
        <Route path="/models/labor/jolts"           element={<JOLTSDashboardPage />} />
        <Route path="/models/labor/productivity"    element={<ProductivityPage />} />
        <Route path="/models/inflation"              element={<InflationPage />} />
        <Route path="/models/inflation/cpi"          element={<CPIDashboardPage />} />
        <Route path="/models/inflation/projections"  element={<CPIProjectionsPage />} />
        <Route path="/models/inflation/pce"              element={<PCEDashboardPage />} />
        <Route path="/models/inflation/pce-projections"  element={<PCEProjectionsPage />} />
        <Route path="/models/inflation/ppi"                element={<PPIDashboardPage />} />
        <Route path="/models/inflation/other"              element={<OtherInflationPage />} />
        <Route path="/models/fiscal"                         element={<FiscalFlowsPage />} />
        <Route path="/models/growth"                         element={<GrowthPage />} />
        <Route path="/models/growth/ngdp"                    element={<NGDPDashboardPage />} />
        <Route path="/models/growth/rgdp"                    element={<RGDPDashboardPage />} />
        <Route path="/treasury"                     element={<TreasuryAuctionPage />} />
        <Route path="/news"                         element={<NewsAggregatorPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
