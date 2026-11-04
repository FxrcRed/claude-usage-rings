import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

// `applied`: `updated` of the tray file as this session last wrote or adopted it; a newer file is another window's reply
const usage = atom({ plugin: 'usage-rings', key: 'state' } as const, { limits: [] as Limit[], applied: 0 })

// Apple system colours; the text tones sit between Apple's light and dark variants so they read on both themes
const GREEN = { ring: '#34c759', text: '#2a9d4b' }
const ORANGE = { ring: '#ff9500', text: '#e07800' }
const RED = { ring: '#ff3b30', text: '#ee3a30' }

const shade = (p: number) => (p >= 85 ? RED : p >= 60 ? ORANGE : GREEN)

const ctxColor = (t: number) => (t >= 230000 ? RED.text : t >= 180000 ? ORANGE.text : undefined)

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
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="22" viewBox="0 0 35.45 30">${ring(12.2, five, shade(five).ring)}${ring(7.2, week, shade(week).ring)}</svg>`

const SPACER = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="1"/>'

const pick = (all: Limit[], kind: string) => all.find(l => l.kind === kind)

// Every window (and the CLI's statusline.py) writes its latest reading here, so a window that is idle or deep in
// a long command can follow what the others have used since its own last reply
const trayFile = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home.replaceAll('\\', '/')}/.claude/tray-state.json` : undefined
}

// Takes the tray file's reading over this session's own when it is the newer: how a window that is idle or deep
// in a long command follows the other windows' replies
const adopt = async ($: EngineInterface) => {
  try {
    const file = await trayFile($)
    if (!file) return
    const s = JSON.parse(await $.fs.read(file))
    if (typeof s.updated !== 'number') return
    const iso = (t: unknown) => (typeof t === 'number' ? new Date(t * 1000).toISOString() : undefined)
    const seeded: Limit[] = []
    if (s.five_hour) seeded.push({ kind: 'five_hour', percentUsed: s.five_hour.pct, resetsAt: iso(s.five_hour.resets_at) })
    if (s.seven_day) seeded.push({ kind: 'seven_day', percentUsed: s.seven_day.pct, resetsAt: iso(s.seven_day.resets_at) })
    if (seeded.length === 0) return
    await update($, usage, prev => {
      // Decided as the store applies it, so a reply of this session that landed meanwhile keeps the upper hand
      if (s.updated <= prev.applied) return prev
      return { applied: s.updated, limits: [...prev.limits.filter(l => l.kind === 'context'), ...seeded] }
    })
  } catch {}
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The engine caches the drawing: without this the "time left" freezes between replies, and the band
    // stays gone for a while after one of the app's own prompts has taken its place
    $.clock.every(15000, () => $.ui.invalidate('ui.render'))
    // A session has no rate-limit data until its first reply: show the last known values meanwhile, and between
    // its replies keep up with the other windows'
    void adopt($)
    $.clock.every(60000, () => adopt($))
    // Windows: install the tray icon, start it and register it to start at login (no-op once done), and
    // bring it back within a minute if something kills it (e.g. another app running Stop-Process -Name pythonw)
    if ((await $.env.get('OS')) === 'Windows_NT') {
      const ensure = `${$.plugin.root}/tray/ensure-tray.ps1`
      const run = (args: string[], timeoutMs: number) => $.process.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { timeoutMs }).catch(() => {})
      void run(['-File', ensure], 180000)
      let busy = false
      $.clock.every(60000, async () => {
        if (busy) return
        busy = true
        await run(['-Command', `if (-not (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -match 'tray[.]py' })) { & '${ensure}' }`], 180000)
        busy = false
      })
    }
    return started
  })

  on('session.measure', async ($, e, next) => {
    const tokens = e.context?.tokens
    const own = e.rateLimits.length > 0
    const now = Math.floor((await $.clock.now()) / 1000)
    await update($, usage, prev => ({
      // Claimed in the step that stores the reading, so a tray read under way cannot put an older one over it
      applied: own ? now : prev.applied,
      limits: [
        ...(own ? e.rateLimits : prev.limits.filter(l => l.kind !== 'context')),
        ...(tokens ? [{ kind: 'context', percentUsed: tokens }] : []),
      ],
    }))
    if (own) {
      const five = pick(e.rateLimits, 'five_hour')
      const week = pick(e.rateLimits, 'seven_day')
      // Optional tray feed: ~/.claude/tray-state.json (see usage-rings/tray/ in the repo); a window missing from this
      // reply keeps its last value instead of being dropped
      const file = await trayFile($)
      let state: Record<string, unknown> = {}
      try {
        if (file) state = JSON.parse(await $.fs.read(file))
      } catch {}
      state.updated = now
      if (five) state.five_hour = { pct: five.percentUsed, resets_at: five.resetsAt && Date.parse(five.resetsAt) / 1000 }
      if (week) state.seven_day = { pct: week.percentUsed, resets_at: week.resetsAt && Date.parse(week.resetsAt) / 1000 }
      if (file) {
        try {
          await $.fs.write(file, JSON.stringify(state))
        } catch {}
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = (await read($, usage)).limits
    const now = await $.clock.now()
    const fresh = (l: Limit | undefined) =>
      l && l.resetsAt && Date.parse(l.resetsAt) <= now ? { ...l, percentUsed: 0, resetsAt: undefined } : l
    const five = fresh(pick(all, 'five_hour'))
    const week = fresh(pick(all, 'seven_day'))
    const { Box, Text, Svg } = $.ui.resolve(e)
    const ctx = pick(all, 'context')?.percentUsed
    if (!five && !week && !ctx) return next(e)
    // Narrow window: keep only the numbers; no Svg (terminal): text only
    const cols = (e as any).props?.bodyColumns ?? (e as any).viewport?.columns
    const narrow = typeof cols === 'number' && cols < 50
    const showRings = !!Svg && (e as any).surface !== 'terminal'
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
          <Box flexDirection="row" alignItems="center">
            {/* 4px spacer: centers the number under the prompt's + button, as the ring sits over the mic */}
            {showRings ? <Svg source={SPACER} alt="" width={4} height={1} /> : null}
            <Text size="caption" tabular dimColor={!ctxColor(ctx)} weight={ctx >= 180000 ? 'medium' : undefined} color={ctxColor(ctx)}>
              {`${Math.round(ctx / 1000)}k`}
            </Text>
          </Box>
          ) : null}
        {narrow ? null : ctx && ctx >= 180000 ? (
          <Text size="caption" color={ctx >= 230000 ? RED.text : ORANGE.text}>Time to start a new chat</Text>
        ) : ctx ? (
          <Text size="caption" dimColor>Fine to keep going here</Text>
        ) : null}
        {!narrow && (five?.percentUsed ?? 0) >= 90 ? (
          <Text size="caption" color={RED.text}>5-hour limit almost used</Text>
        ) : null}
      </Box>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={2}>
          {line(five, !narrow)}
          {!narrow && (week?.percentUsed ?? 0) >= 80 ? line(week, true) : null}
        </Box>
        {showRings ? <Svg
          source={rings(five?.percentUsed ?? 0, week?.percentUsed ?? 0)}
          alt={`5-hour ${Math.round(five?.percentUsed ?? 0)}%, weekly ${Math.round(week?.percentUsed ?? 0)}%`}
          width={26}
          height={22}
        /> : null}
      </Box>
      </Box>
    )
  })
}
