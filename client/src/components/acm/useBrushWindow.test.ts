// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBrushWindow } from './useBrushWindow'

describe('useBrushWindow', () => {
  it('starts on the full range, follows the brush, and resets when the data length changes', () => {
    const { result, rerender } = renderHook(({ n }) => useBrushWindow(n), { initialProps: { n: 100 } })
    expect([result.current.start, result.current.end]).toEqual([0, 99])
    act(() => result.current.onChange({ startIndex: 40, endIndex: 80 }))
    expect([result.current.start, result.current.end]).toEqual([40, 80])
    act(() => result.current.onChange({}))
    expect([result.current.start, result.current.end]).toEqual([40, 80])
    rerender({ n: 30 })
    expect([result.current.start, result.current.end]).toEqual([0, 29])
  })
})
