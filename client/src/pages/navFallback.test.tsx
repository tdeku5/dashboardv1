// Synthetic-country fallback coverage. With all eight real countries live,
// no COUNTRIES entry lacks content anymore — but the coming-soon path must
// keep working for any FUTURE country added to the bar before its models
// exist. This file mocks modelNav's COUNTRIES to include a synthetic entry
// ('zz' / ZZLAND) and asserts the fallback still renders: country bar intact,
// coming-soon body, no crash. (Real-country absent-CATEGORY fallbacks — AU
// fiscal/industrial, JP fiscal/housing — are covered in navParams.test.tsx.)
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('./modelNav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./modelNav')>()
  return {
    ...actual,
    COUNTRIES: [...actual.COUNTRIES, { key: 'zz', label: 'ZZLAND' }],
  }
})

import { FiscalPage } from './FiscalPage'
import { ModelsPage } from './ModelsPage'

function renderAt(url: string, path: string, el: JSX.Element): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path={path} element={el} /></Routes>
    </MemoryRouter>
  )
}

describe('synthetic-country coming-soon fallback (future-country coverage)', () => {
  it('hub renders coming-soon with the country bar for a contentless country', () => {
    const html = renderAt('/models/fiscal?country=zz', '/models/fiscal', <FiscalPage />)
    expect(html).toContain('ZZLAND fiscal models coming soon')
    expect(html).toContain('>ZZLAND<')
  })
  it('models landing renders coming-soon for a contentless country', () => {
    const html = renderAt('/models?country=zz', '/models', <ModelsPage />)
    expect(html).toContain('ZZLAND models coming soon')
  })
})
