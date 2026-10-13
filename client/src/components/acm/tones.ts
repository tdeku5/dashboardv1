import tones from './tones.module.css'
import type { AlertLevel, SignTone } from './acmFormat'

export function toneClass(tone: SignTone | undefined): string | undefined {
  switch (tone) {
    case 'positive': return tones.positive
    case 'negative': return tones.negative
    case 'dir-up': return tones.dirUp
    case 'dir-down': return tones.dirDown
    default: return undefined
  }
}

export function alertClass(alert: AlertLevel | undefined): string | undefined {
  if (alert === 'mild') return tones.alertMild
  if (alert === 'strong') return tones.alertStrong
  return undefined
}
