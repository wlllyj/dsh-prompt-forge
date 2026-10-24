import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, applyModelOverride, buildDoctrine, readConfig } from '../index.js'

const route = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' }

test('the doctrine keeps the ask-first opening when the switch is on', () => {
  const on = buildDoctrine(true)
  assert.match(on, /先问再答/u)
  assert.match(on, /只问不答/u)
  assert.doesNotMatch(on, /已知前提与待确认/u)
})

test('the doctrine replaces the opening when the switch is off', () => {
  const off = buildDoctrine(false)
  assert.doesNotMatch(off, /先问再答/u)
  assert.match(off, /已知前提与待确认/u)
  assert.match(off, /仍不确定、需要我确认的点/u)
})

test('both doctrines still carry the shared rules', () => {
  for (const text of [buildDoctrine(true), buildDoctrine(false)]) {
    assert.match(text, /判据代替禁令/u)
    assert.match(text, /上下文五层/u)
    assert.match(text, /只输出改写后的提示词正文/u)
  }
})

test('readConfig reads a volatile ref', () => {
  const config = Config({})
  assert.equal(readConfig(config.askFirst, false), true)
  assert.equal(readConfig(config.temperature, 0), 0.35)
  assert.equal(readConfig(config.model, 'x'), '')
  assert.equal(readConfig(config.extraRules, 'y'), '')
})

test('readConfig passes plain values and falls back when absent', () => {
  assert.equal(readConfig(false, true), false)
  assert.equal(readConfig('', 'fallback'), '')
  assert.equal(readConfig(undefined, 7), 7)
})

test('applyModelOverride keeps the route when the field is empty', () => {
  assert.deepEqual(applyModelOverride(route, ''), route)
  assert.deepEqual(applyModelOverride(route, '   '), route)
  assert.deepEqual(applyModelOverride(route, undefined), route)
})

test('applyModelOverride swaps the model or the whole route', () => {
  assert.deepEqual(applyModelOverride(route, 'glm-4.6'), { ...route, model: 'glm-4.6' })
  assert.deepEqual(applyModelOverride(route, 'openai/gpt-5'), { provider: 'openai', model: 'gpt-5' })
})
