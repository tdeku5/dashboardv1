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
import { NewsAggregatorPage }    from './pages/NewsAggregatorPage'

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
        <Route path="/news"                         element={<NewsAggregatorPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
