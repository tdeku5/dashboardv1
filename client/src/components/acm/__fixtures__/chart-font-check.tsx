// Fixture for chartFontLoading.browser.test.ts — see chart-font-check.html.
// Deliberately NOT wrapped in .acm-root: the measured-text font literals and
// the global @font-face rules must work without it.
import { createRoot } from 'react-dom/client'
import { LineChart, Line, CartesianGrid, XAxis, YAxis } from 'recharts'
import '../../../styles/globals.css' // the app's <body> face, which Recharts measures ticks in
import '../../../styles/acm-tokens.css'
import { chartTheme } from '../chartTheme'

const data = Array.from({ length: 12 }, (_, i) => ({ x: `2026-${String(i + 1).padStart(2, '0')}`, y: Math.sin(i) * 120 }))

createRoot(document.getElementById('root')!).render(
  <LineChart width={640} height={240} data={data} id="acm-font-check-chart">
    <CartesianGrid {...chartTheme.grid} />
    <XAxis dataKey="x" {...chartTheme.xAxis} />
    <YAxis {...chartTheme.yAxis} />
    <Line dataKey="y" stroke="#60a5fa" isAnimationActive={false} />
  </LineChart>,
)
