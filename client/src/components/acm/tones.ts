import tones from './tones.module.css'
import type { AlertLevel, SignTone } from './acmFormat'

export function toneClass(tone: SignTone | undefined): string | undefined {
  switch (tone) {
    case 'positive': return tones.positive
    case 'negative': return tones.negative
    case 'dir-up': return tones.dirUp
    case 'dir-down': return tones.dirDown
    case 'vol-premium-up': return tones.volPremiumUp
    case 'vol-premium-down': return tones.volPremiumDown
    default: return undefined
  }
}

export function alertClass(alert: AlertLevel | undefined): string | undefined {
  if (alert === 'mild') return tones.alertMild
  if (alert === 'strong') return tones.alertStrong
  return undefined
}
