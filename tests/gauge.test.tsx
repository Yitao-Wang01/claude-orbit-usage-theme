import { expect, test } from 'claude-code/testing'

const BACKDROP = {
  plugin: 'orbit-usage',
  component: 'Backdrop',
  props: {
    scene: 'orbit-usage',
    plugin: 'orbit-usage',
    glass: { blur: 0, tint: '#070a1c', opacity: 0.5 },
  },
} as const

test('a reading flies the ship and the satellite', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42.5, resetsAt: '2026-11-25T14:14:00Z' },
      { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-11-28T16:00:00Z' },
    ],
    changed: ['rateLimits'],
  })

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BACKDROP, surface })
    expect(await ui.drawn()).toMatchObject({
      type: 'Shader',
      props: { values: { five: 42.5, week: 18, hasFive: 1, hasWeek: 1 } },
    })
    await ui.unmount()
  }
})

test('with no reading the craft stay hidden', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect(await ui.drawn()).toMatchObject({
    type: 'Shader',
    props: { values: { hasFive: 0, hasWeek: 0 } },
  })
  await ui.unmount()
})

test("another mod's backdrop is left alone", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    ...BACKDROP,
    props: { ...BACKDROP.props, plugin: 'low-orbit', scene: 'low-orbit' },
    surface: 'desktop',
  })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
