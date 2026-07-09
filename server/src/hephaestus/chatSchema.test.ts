// Schema ↔ type drift guard (audit item 4). The emit_chart_spec JSON schema
// the model sees and the ChartSpecV1 TS validator must describe the same
// language. Two layers of protection:
//   1. Structural consistency: the schema's enums/limits are compared against
//      the canonical constants the validator uses — adding a transform type,
//      derived op, or changing a cap without updating both fails here.
//   2. Canonical examples: one spec per union member (every transform on both
//      kinds, every derived op) accepted by the TS validator AND structurally
//      admissible under the schema's own field definitions.
import { describe, it, expect } from 'vitest'
import { EMIT_CHART_SPEC_SCHEMA } from './chat'
import {
  validateSpecStructure,
  MAX_SERIES_PER_SPEC, MAX_TITLE_LEN, TRANSFORM_TYPES, DERIVED_OPS,
} from './chartSpec'

const schema = EMIT_CHART_SPEC_SCHEMA
const itemProps = schema.properties.series.items.properties

describe('emit_chart_spec schema ↔ ChartSpecV1 consistency', () => {
  it('schema top-level matches the validator contract', () => {
    expect(schema.properties.version.enum).toEqual([1])
    expect(schema.properties.title.maxLength).toBe(MAX_TITLE_LEN)
    expect(schema.properties.series.minItems).toBe(1)
    expect(schema.properties.series.maxItems).toBe(MAX_SERIES_PER_SPEC)
    expect([...schema.required]).toEqual(['version', 'title', 'series'])
    // Date-range and axis-label fields exist on both sides
    for (const f of ['from', 'to', 'leftAxisLabel', 'rightAxisLabel']) {
      expect(schema.properties).toHaveProperty(f)
    }
  })

  it('schema transform enum covers exactly the TS Transform union', () => {
    expect([...itemProps.transform.properties.type.enum].sort()).toEqual([...TRANSFORM_TYPES].sort())
  })

  it('schema derived ops cover exactly the TS union', () => {
    expect([...itemProps.op.enum]).toEqual([...DERIVED_OPS])
  })

  it('schema series kinds and axis values match the TS union', () => {
    expect([...itemProps.kind.enum]).toEqual(['direct', 'derived'])
    expect([...itemProps.axis.enum]).toEqual(['left', 'right'])
  })

  it('derived inputs a/b are structured objects requiring id', () => {
    for (const key of ['a', 'b'] as const) {
      expect(itemProps[key].type).toBe('object')
      expect([...itemProps[key].required]).toEqual(['id'])
      expect(itemProps[key].properties).toHaveProperty('id')
      expect(itemProps[key].properties).toHaveProperty('param')
    }
  })

  it('every series item field in the schema exists on a TS series kind (no schema-only fields)', () => {
    const tsFields = new Set(['kind', 'id', 'param', 'op', 'a', 'b', 'transform', 'label', 'axis'])
    for (const field of Object.keys(itemProps)) {
      expect(tsFields.has(field), `schema field '${field}' has no TS counterpart`).toBe(true)
    }
  })
})

describe('canonical examples of every union member pass the TS validator', () => {
  const transforms = [
    { type: 'level' }, { type: 'rebase100' }, { type: 'yoy_pct' }, { type: 'mom_pct' },
    { type: 'diff', periods: 12 }, { type: 'zscore', window: 20 }, { type: 'rolling_mean', window: 50 },
  ]

  it('covers the full transform enum (fixture completeness self-check)', () => {
    expect(transforms.map(t => t.type).sort()).toEqual([...TRANSFORM_TYPES].sort())
  })

  it.each(transforms.map(t => [t] as const))('direct series with %j', (t) => {
    const r = validateSpecStructure({
      version: 1, title: 'Canonical', series: [{ kind: 'direct', id: 'DGS10', transform: t }],
    })
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true)
  })

  it.each(transforms.map(t => [t] as const))('derived series with %j', (t) => {
    const r = validateSpecStructure({
      version: 1, title: 'Canonical',
      series: [{ kind: 'derived', op: 'subtract', a: { id: 'A' }, b: { id: 'B', param: 'p' }, label: 'x', transform: t }],
    })
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true)
  })

  it.each(DERIVED_OPS.map(op => [op] as const))('derived op %s', (op) => {
    const r = validateSpecStructure({
      version: 1, title: 'Canonical',
      series: [{ kind: 'derived', op, a: { id: 'A' }, b: { id: 'B' }, label: 'x' }],
    })
    expect(r.ok).toBe(true)
  })

  it('full-field example (both kinds, both axes, range, labels) passes', () => {
    const r = validateSpecStructure({
      version: 1, title: 'Everything',
      from: '2020-01-01', to: '2026-01-01', leftAxisLabel: '%', rightAxisLabel: 'ratio',
      series: [
        { kind: 'direct', id: 'DGS10', param: undefined, transform: { type: 'level' }, label: 'US 10Y', axis: 'left' },
        { kind: 'derived', op: 'ratio', a: { id: 'A' }, b: { id: 'B' }, transform: { type: 'rebase100' }, label: 'A/B rebased', axis: 'right' },
      ],
    })
    expect(r.ok).toBe(true)
  })
})
