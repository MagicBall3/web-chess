import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankCandidates, SELECTION_STYLES } from '../src/moveSelector.js'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

// Позиция, где Qd1-d2 оставляет ферзя под ударом ладьи d8, а Qd1-e2 — безопасно.
const HANGING_FEN = '3r2k1/8/8/8/8/8/8/3QK3 w - - 0 1'

const cands = [
  { multipv: 1, score: { type: 'cp', value: 50 }, pv: ['e2e4'], bestMove: 'e2e4' },
  { multipv: 2, score: { type: 'cp', value: 20 }, pv: ['g1f3'], bestMove: 'g1f3' },
  { multipv: 3, score: { type: 'cp', value: -30 }, pv: ['a2a3'], bestMove: 'a2a3' },
]

test('ранжирование для белых: по перспективе ходящего, потеря относительно лучшего', () => {
  const ranked = rankCandidates(cands, { fen: START_FEN, sideToMove: 'w', style: 'balanced' })
  assert.equal(ranked.length, 3)
  assert.equal(ranked[0].move, 'e2e4')
  assert.equal(ranked[0].loss, 0)
  assert.equal(ranked[1].move, 'g1f3')
  assert.equal(ranked[1].loss, 30)
  assert.equal(ranked[2].move, 'a2a3')
  assert.equal(ranked[2].loss, 80)
  // перспектива белых
  assert.equal(ranked[0].scoreWhite, 50)
  assert.equal(ranked[2].scoreWhite, -30)
})

test('нормализация для чёрных: знаки инвертируются, лучший — с максимальным mover-скором', () => {
  const ranked = rankCandidates(cands, { fen: START_FEN, sideToMove: 'b', style: 'balanced' })
  // для чёрных mover = -score: e2e4 -> -50, g1f3 -> -20, a2a3 -> 30
  assert.equal(ranked[0].move, 'a2a3')
  // score a2a3 = -30 (чёрные в минусе) -> в перспективе белых это +30
  assert.equal(ranked[0].scoreWhite, 30)
  assert.equal(ranked[0].loss, 0)
  assert.equal(ranked[2].move, 'e2e4')
})

test('стиль solid штрафует ходы, после которых фигура висит', () => {
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['d1e2'], bestMove: 'd1e2' },
    { multipv: 2, score: { type: 'cp', value: -40 }, pv: ['d1d2'], bestMove: 'd1d2' },
  ]
  const balanced = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', style: 'balanced' })
  const solid = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', style: 'solid' })

  assert.equal(balanced[1].tactical.hangsAfterMove, true)
  assert.equal(balanced[1].adjustedLoss, 40)
  assert.equal(solid[1].adjustedLoss, 40 + 60)
  assert.ok(solid[1].note.length > 0)
})

test('стиль aggressive поощряет взятия', () => {
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['d1e2'], bestMove: 'd1e2' },
    { multipv: 2, score: { type: 'cp', value: -20 }, pv: ['d1d8'], bestMove: 'd1d8' },
  ]
  const aggressive = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', style: 'aggressive' })
  // d1d8 — взятие ладьи, штраф за потерю уменьшается
  const capt = aggressive.find((x) => x.move === 'd1d8')
  assert.equal(capt.tactical.captures, true)
  assert.equal(capt.adjustedLoss, 20 - 30)
})

test('positionalHook: расширяемый хук добавляет дельту к adjustedLoss', () => {
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['d1e2'], bestMove: 'd1e2' },
    { multipv: 2, score: { type: 'cp', value: -40 }, pv: ['d1d2'], bestMove: 'd1d2' },
  ]
  const ranked = rankCandidates(c, {
    fen: HANGING_FEN,
    sideToMove: 'w',
    style: 'balanced',
    positionalHook: (x) => (x.move === 'd1d2' ? 500 : 0),
  })
  assert.equal(ranked[0].move, 'd1e2')
  assert.equal(ranked[1].move, 'd1d2')
  assert.equal(ranked[1].adjustedLoss, 40 + 500)
})

test('пустой список кандидатов возвращает []', () => {
  assert.deepEqual(rankCandidates([], { fen: START_FEN }), [])
})

test('реестр стилей содержит ожидаемые ключи', () => {
  assert.ok(SELECTION_STYLES.balanced)
  assert.ok(SELECTION_STYLES.solid)
  assert.ok(SELECTION_STYLES.aggressive)
})
