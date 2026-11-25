import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionRateLimit,
  ThemeSetArgs,
} from 'claude-code'

import type { Gauge } from '../types'
import { makeColors } from './make-colors.js'
import { SCENE } from './scene.js'

const SCENE_NAME = 'orbit-usage'

// Low Orbit's colors, by ClaudeFolio (MIT, see LICENSE.claudefolio).
const { theme, problems } = makeColors({
  label: 'Low Orbit Usage',
  only: 'dark',
  roles: { accent: '#7ab8ff', danger: '#ff6b7a', success: '#5affb0', warning: '#ffd08a', pro: '#b8a6ff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#070a1c',
        'surface-1': '#0c1024',
        'surface-2': '#11152c',
        'surface-3': '#161a34',
        'text-primary': '#eef2ff',
        'text-secondary': '#c8cfe8',
        'text-muted': '#9399bf',
      },
    },
  },
})

// No blur on the glass: blurring a moving backdrop costs CPU on every change.
const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 0, tint: '#070a1c', opacity: 0.5 } },
}

// Change the tag when Gauge's fields change: it declines what an earlier
// version stored, which outlives a reload.
const gauge = atom({ plugin: 'orbit-usage', key: 'gauge' } as const, null, {
  shape: 'gauge-1',
})

const percentOf = (limits: SessionRateLimit[], kind: string) =>
  limits.find(l => l.kind === kind)?.percentUsed ?? null

const toGauge = (limits: SessionRateLimit[]): Gauge => ({
  five: percentOf(limits, 'five_hour'),
  week: percentOf(limits, 'seven_day'),
})

// The theme stands for the session; sent again when a client attaches so one
// that joined late gets it.
const applyLook = async ($: EngineInterface) => {
  const set = await $.theme.set(LOOK)
  $.ui.status(set.isDrawn ? undefined : set.reason)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    await applyLook($)
    const { rateLimits } = await $.session.usage()
    await update($, gauge, () => toGauge(rateLimits))

    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await applyLook($)

    return attached
  })

  // Pushed after each turn and whenever a plan window moves a whole point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, gauge, () => toGauge(e.rateLimits))
    }

    return next(e)
  })

  // The scene is drawn once; a new reading changes only the shader's values,
  // which the app eases to without redrawing the scene.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== $.plugin.name || e.props.scene !== SCENE_NAME) {
      return next(e)
    }
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }

    const g = await read($, gauge)
    const { Shader, Svg } = $.ui.resolve(e)

    return (
      <Shader
        module="./gauge.ts"
        values={{
          five: g?.five ?? 0,
          week: g?.week ?? 0,
          hasFive: g?.five == null ? 0 : 1,
          hasWeek: g?.week == null ? 0 : 1,
        }}
      >
        <Svg
          source={SCENE}
          alt="Night side of Earth from orbit with city lights, an aurora, a sunrise glow on the horizon, a space station, and the moon"
        />
      </Shader>
    )
  })
}
