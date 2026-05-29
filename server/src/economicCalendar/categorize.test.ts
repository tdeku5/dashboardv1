import { describe, it, expect } from 'vitest'
import { classifyCategory } from './categorize'

describe('classifyCategory', () => {
  it('classifies inflation prints (all stages)', () => {
    expect(classifyCategory('Core Inflation Rate YoY Flash')).toBe('Inflation')
    expect(classifyCategory('Inflation Rate MoM')).toBe('Inflation')
    expect(classifyCategory('PPI MoM')).toBe('Inflation')
    expect(classifyCategory('HICP YoY Final')).toBe('Inflation')
    expect(classifyCategory('PCE Price Index MoM')).toBe('Inflation')
  })

  it('classifies labor', () => {
    expect(classifyCategory('Unemployment Rate')).toBe('Labor')
    expect(classifyCategory('ADP Employment Change')).toBe('Labor')
    expect(classifyCategory('Initial Jobless Claims')).toBe('Labor')
    expect(classifyCategory('Non Farm Payrolls')).toBe('Labor')
    expect(classifyCategory('Average Hourly Earnings MoM')).toBe('Labor')
  })

  it('separates GDP volume (Growth) from GDP price (Inflation)', () => {
    expect(classifyCategory('GDP Growth Rate QoQ')).toBe('Growth')
    expect(classifyCategory('GDP Price Index QoQ')).toBe('Inflation')
    expect(classifyCategory('Industrial Production YoY')).toBe('Growth')
  })

  it('classifies central-bank speeches/decisions/reports', () => {
    expect(classifyCategory('Fed Logan Speech')).toBe('CB Speeches')
    expect(classifyCategory('ECB Financial Stability Review')).toBe('CB Speeches')
    expect(classifyCategory('RBA Bulletin')).toBe('CB Speeches')
    expect(classifyCategory('Interest Rate Decision')).toBe('CB Speeches')
    expect(classifyCategory('FOMC Minutes')).toBe('CB Speeches')
  })

  it('classifies surveys vs consumption confidence', () => {
    expect(classifyCategory('Manufacturing PMI')).toBe('Surveys')
    expect(classifyCategory('S&P Global Services PMI')).toBe('Surveys')
    expect(classifyCategory('Chicago PMI')).toBe('Surveys')
    expect(classifyCategory('ISM Manufacturing PMI')).toBe('Surveys')
    expect(classifyCategory('Michigan Consumer Sentiment')).toBe('Surveys')
    // Consumer *Confidence* is intentionally Consumption, not Surveys
    expect(classifyCategory('Consumer Confidence')).toBe('Consumption')
  })

  it('classifies housing, trade, consumption, production', () => {
    expect(classifyCategory('Housing Starts')).toBe('Housing')
    expect(classifyCategory('MBA 30-Year Mortgage Rate')).toBe('Housing')
    expect(classifyCategory('Balance of Trade')).toBe('Trade')
    expect(classifyCategory('Current Account')).toBe('Trade')
    expect(classifyCategory('Retail Sales MoM')).toBe('Consumption')
    expect(classifyCategory('Personal Spending')).toBe('Consumption')
    expect(classifyCategory('New Car Registrations YoY')).toBe('Consumption')
    expect(classifyCategory('Durable Goods Orders MoM')).toBe('Production')
    expect(classifyCategory('Factory Orders MoM')).toBe('Production')
  })

  it('falls back to Other for unmatched events', () => {
    expect(classifyCategory('API Crude Oil Stock Change')).toBe('Other')
    expect(classifyCategory('Some Brand New Indicator')).toBe('Other')
  })
})
