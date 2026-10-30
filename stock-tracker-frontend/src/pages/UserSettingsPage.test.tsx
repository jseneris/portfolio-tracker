import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BUY_TARGET_PRESETS, BuyTargetPresetSlider } from './UserSettingsPage'

function formValues(percentages: readonly number[]) {
  return {
    buyTargetPercentAtBaseSize: String(percentages[0]),
    buyTargetPercentBasePlus1: String(percentages[1]),
    buyTargetPercentBasePlus2: String(percentages[2]),
    buyTargetPercentBasePlus3OrMore: String(percentages[3]),
  }
}

describe('buy target presets', () => {
  it('defines the four confirmed percentage sets in slider order', () => {
    expect(BUY_TARGET_PRESETS).toEqual([
      { name: 'Aggressive', percentages: [10, 15, 20, 25] },
      { name: 'Base', percentages: [13, 20, 27, 33] },
      { name: 'Scared', percentages: [17, 25, 33, 42] },
      { name: 'Fearful', percentages: [20, 30, 40, 50] },
    ])
  })

  it.each(BUY_TARGET_PRESETS)('recognizes saved $name percentages', (preset) => {
    const html = renderToStaticMarkup(createElement(BuyTargetPresetSlider, {
      form: formValues(preset.percentages), disabled: false, onChange: () => {},
    }))
    expect(html).toContain(`Buy Target Preset: ${preset.name}`)
    expect(html).toContain(`aria-valuetext="${preset.name}"`)
    expect(html).toContain(`value="${BUY_TARGET_PRESETS.indexOf(preset)}"`)
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Custom for individually edited percentages instead of claiming a preset', () => {
    const html = renderToStaticMarkup(createElement(BuyTargetPresetSlider, {
      form: formValues([11, 15, 20, 25]), disabled: false, onChange: () => {},
    }))
    expect(html).toContain('aria-valuetext="Custom"')
    expect(html).not.toContain('aria-pressed="true"')
    expect(html).toContain('Custom values do not match a preset')
  })

  it('matches numeric values regardless of decimal formatting', () => {
    const html = renderToStaticMarkup(createElement(BuyTargetPresetSlider, {
      form: { ...formValues([10, 15, 20, 25]), buyTargetPercentAtBaseSize: '10.0000' },
      disabled: false, onChange: () => {},
    }))
    expect(html).toContain('aria-valuetext="Aggressive"')
  })

  it('disables the slider and all preset buttons while saving', () => {
    const html = renderToStaticMarkup(createElement(BuyTargetPresetSlider, {
      form: formValues([10, 15, 20, 25]), disabled: true, onChange: () => {},
    }))
    expect(html.match(/disabled=""/g)).toHaveLength(5)
  })
})
