// @vitest-environment happy-dom
// Composer interaction tests (design-pass acceptance): disabled-send behavior
// and empty-state chips populating the input. Mounted with the real React DOM
// under happy-dom — no fetch fires (interactions here never submit).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { HephaestusPage, EXAMPLE_PROMPTS } from './HephaestusPage'

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<MemoryRouter><HephaestusPage /></MemoryRouter>)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function sendButton(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
  if (!el) throw new Error('send button not found')
  return el
}

function composerInput(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('textarea')
  if (!el) throw new Error('composer textarea not found')
  return el
}

async function typeIntoComposer(text: string) {
  const el = composerInput()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Hephaestus composer interactions', () => {
  it('send is disabled while the input is empty and enables once text is typed', async () => {
    expect(sendButton().disabled).toBe(true)

    await typeIntoComposer('US 10Y vs DE 10Y')
    expect(sendButton().disabled).toBe(false)

    await typeIntoComposer('   ')   // whitespace-only stays disabled
    expect(sendButton().disabled).toBe(true)
  })

  it('clicking an empty-state example chip populates the composer', async () => {
    const chips = [...container.querySelectorAll('button')]
      .filter(b => EXAMPLE_PROMPTS.includes(b.textContent ?? ''))
    expect(chips.length).toBe(EXAMPLE_PROMPTS.length)

    await act(async () => { chips[0].click() })

    expect(composerInput().value).toBe(EXAMPLE_PROMPTS[0])
    expect(sendButton().disabled).toBe(false)
  })
})
