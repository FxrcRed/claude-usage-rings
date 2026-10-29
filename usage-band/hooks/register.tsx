import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [] as Limit[])

const shade = (p: number) =>
  p >= 85 ? { ring: p >= 90 ? '#d70015' : '#f5362b', text: '#d70015' }
  : p >= 60 ? { ring: '#ff9f0a', text: '#c77700' }
  : { ring: '#62b800', text: '#3f8a00' }

const ctxColor = (t: number) => (t >= 230000 ? '#d70015' : t >= 180000 ? '#c77700' : undefined)

const left = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

const ring = (r: number, p: number, color: string) => {
  const c = 2 * Math.PI * r
  const v = Math.max(0.5, Math.min(100, p)) / 100
  return `<circle cx="15" cy="15" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.22" stroke-width="4.5"/><circle cx="15" cy="15" r="${r}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 15 15)"/>`
}

const rings = (five: number, week: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="22" viewBox="-5.45 0 35.45 30">${ring(12.2, five, shade(five).ring)}${ring(7.2, week, shade(week).ring)}</svg>`

const pick = (all: Limit[], kind: string) => all.find(l => l.kind === kind)

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    const tokens = e.context?.tokens
    await update($, limits, prev => [
      ...(e.rateLimits.length > 0 ? e.rateLimits : prev.filter(l => l.kind !== 'context')),
      ...(tokens ? [{ kind: 'context', percentUsed: tokens }] : []),
    ])
    if (e.rateLimits.length > 0) {
      const five = pick(e.rateLimits, 'five_hour')
      const week = pick(e.rateLimits, 'seven_day')
      const state: Record<string, unknown> = { updated: Math.floor((await $.clock.now()) / 1000) }
      if (five) state.five_hour = { pct: five.percentUsed, resets_at: five.resetsAt && Date.parse(five.resetsAt) / 1000 }
      if (week) state.seven_day = { pct: week.percentUsed, resets_at: week.resetsAt && Date.parse(week.resetsAt) / 1000 }
      // Optional tray feed: ~/.claude/tray-state.json (see tray/ in the repo)
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      if (home) {
        try {
          await $.fs.write(`${home.replaceAll('\\', '/')}/.claude/tray-state.json`, JSON.stringify(state))
        } catch {}
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, limits)
    const now = await $.clock.now()
    const fresh = (l: Limit | undefined) =>
      l && l.resetsAt && Date.parse(l.resetsAt) <= now ? { ...l, percentUsed: 0, resetsAt: undefined } : l
    const five = fresh(pick(all, 'five_hour'))
    const week = fresh(pick(all, 'seven_day'))
    const { Box, Text, Svg } = $.ui.resolve(e)
    const ctx = pick(all, 'context')?.percentUsed
    if (!five && !week && !ctx) return next(e)
    const line = (l: Limit | undefined, showTime: boolean) => {
      const p = l ? Math.round(l.percentUsed) : 0
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text size="caption" tabular color={shade(p).text}>
            {l ? `${p}%` : '--'}
          </Text>
          {showTime && l?.resetsAt ? (
            <Text size="caption" dimColor tabular>{left(l.resetsAt, now)}</Text>
          ) : null}
        </Box>
      )
    }
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%">
      <Box flexDirection="row" alignItems="center" gap={2}>
        {ctx ? (
            <Text size="caption" tabular dimColor={!ctxColor(ctx)} weight={ctx >= 180000 ? 'medium' : undefined} color={ctxColor(ctx)}>
              {`${Math.round(ctx / 1000)}k`}
            </Text>
          ) : null}
        {ctx && ctx >= 180000 ? (
          <Text size="caption" color={ctx >= 230000 ? '#d70015' : '#c77700'}>Time to start a new chat</Text>
        ) : ctx ? (
          <Text size="caption" dimColor>Fine to keep going here</Text>
        ) : null}
        {(five?.percentUsed ?? 0) >= 90 ? (
          <Text size="caption" color="#d70015">5-hour limit almost used</Text>
        ) : null}
      </Box>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={2}>
          {line(five, true)}
          {(week?.percentUsed ?? 0) >= 80 ? line(week, true) : null}
        </Box>
        <Svg
          source={rings(five?.percentUsed ?? 0, week?.percentUsed ?? 0)}
          alt={`5-hour ${Math.round(five?.percentUsed ?? 0)}%, weekly ${Math.round(week?.percentUsed ?? 0)}%`}
          width={26}
          height={22}
        />
      </Box>
      </Box>
    )
  })
}
