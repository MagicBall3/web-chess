import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STRENGTH_LEVELS,
  MANUAL_ELO_MIN,
  MANUAL_ELO_MAX,
  strengthToEngineOptions,
  strengthLabel,
} from '../src/strength.js'

test('уровни силы содержат все ключи по порядку', () => {
  const keys = STRENGTH_LEVELS.map((l) => l.key)
  assert.deepEqual(keys, ['beginner', 'casual', 'intermediate', 'advanced', 'expert', 'master', 'maximum'])
})

test('Beginner -> Skill Level 0', () => {
  assert.deepEqual(strengthToEngineOptions({ levelKey: 'beginner' }), { skillLevel: 0 })
})

test('Master -> Skill Level 18', () => {
  assert.deepEqual(strengthToEngineOptions({ levelKey: 'master' }), { skillLevel: 18 })
})

test('Maximum -> без ограничений', () => {
  assert.deepEqual(strengthToEngineOptions({ levelKey: 'maximum' }), {})
  assert.deepEqual(strengthToEngineOptions(null), {})
})

test('ручной Elo -> UCI_Elo', () => {
  assert.deepEqual(strengthToEngineOptions({ manualElo: 1500 }), { elo: 1500 })
})

test('диапазон ручного Elo корректен', () => {
  assert.ok(MANUAL_ELO_MIN < MANUAL_ELO_MAX)
  assert.equal(MANUAL_ELO_MIN, 600)
  assert.equal(MANUAL_ELO_MAX, 2800)
})

test('название уровня', () => {
  assert.equal(strengthLabel({ levelKey: 'expert' }), 'Expert')
  assert.equal(strengthLabel({ manualElo: 2000 }), 'Elo 2000')
  assert.equal(strengthLabel(null), 'Maximum')
})
