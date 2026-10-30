import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 58, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 30, resetsAt: '2099-01-03T00:00:00Z' },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

// The plugin writes ~/.claude/tray-state.json and, on Windows, starts the tray: point both elsewhere
const ENV = { USERPROFILE: 'C:/Users/26935/AppData/Local/Temp/usage-rings-test', OS: 'test' }

const mount = async ($: any, on: any, surface: 'terminal' | 'desktop', bodyColumns: number, rateLimits = WINDOWS) => {
  mock.store(on)
  mock.env(on, ENV)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.start({ surface, isInteractive: true, cwd: '/work' })
  await $.session.measure({ context: { window: 1000000 }, rateLimits, changed: ['rateLimits'] })
  return $.ui.mount({ plugin: 'usage-rings', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
}

test('a wide band shows percent used and time left for the 5-hour window', async ($, on) => {
  const band = await mount($, on, 'desktop', 100)
  expect(await band.find({ text: '58%' })).toBeDefined()
  expect(await band.find({ text: '2h 0m' })).toBeDefined()
  await band.unmount()
})

test('a narrow band drops the reset time and the weekly figure', async ($, on) => {
  const band = await mount($, on, 'desktop', 40, [{ ...WINDOWS[0], percentUsed: 58 }, { ...WINDOWS[1], percentUsed: 90 }])
  expect(await band.find({ text: '58%' })).toBeDefined()
  expect(await band.find({ text: '2h 0m' })).toBeUndefined()
  expect(await band.find({ text: '90%' })).toBeUndefined()
  await band.unmount()
})

test('the terminal draws no rings', async ($, on) => {
  const band = await mount($, on, 'terminal', 100)
  expect(await band.find({ text: '58%' })).toBeDefined()
  expect(await band.find({ type: 'Svg' })).toBeUndefined()
  await band.unmount()
})

test('a window whose reset time has passed reads as unused', async ($, on) => {
  const band = await mount($, on, 'desktop', 100, [{ kind: 'five_hour', percentUsed: 58, resetsAt: '2098-12-31T21:00:00Z' }])
  expect(await band.find({ text: '0%' })).toBeDefined()
  await band.unmount()
})
