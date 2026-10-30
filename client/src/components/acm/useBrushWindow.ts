import { useCallback, useEffect, useState } from 'react'

/**
 * Tracks the index window an uncontrolled Recharts <Brush> is showing, so a y
 * axis computed with niceAxis can follow the brushed data the way Recharts'
 * own auto domain did. Resets to the full range whenever the data length
 * changes (range buttons, new fetch).
 */
export function useBrushWindow(length: number): { start: number; end: number; onChange: (r: { startIndex?: number; endIndex?: number }) => void } {
  const [win, setWin] = useState({ start: 0, end: Math.max(0, length - 1) })
  useEffect(() => { setWin({ start: 0, end: Math.max(0, length - 1) }) }, [length])
  const onChange = useCallback((r: { startIndex?: number; endIndex?: number }) => {
    if (typeof r.startIndex === 'number' && typeof r.endIndex === 'number') setWin({ start: r.startIndex, end: r.endIndex })
  }, [])
  return { ...win, onChange }
}
