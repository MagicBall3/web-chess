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
  const balanced = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', mode: 'human', style: 'balanced' })
  const solid = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', mode: 'human', style: 'solid' })

  const bD2 = balanced.find((x) => x.move === 'd1d2')
  const sD2 = solid.find((x) => x.move === 'd1d2')
  assert.equal(bD2.tactical.hangsAfterMove, true)
  assert.ok(sD2.adjustedLoss > bD2.adjustedLoss, 'solid должен штрафовать висящую фигуру сильнее')
  assert.ok(sD2.note.length > 0)
})

test('стиль aggressive поощряет взятия', () => {
  // Прямая проверка модификатора: взятие уменьшает adjustedLoss на 30.
  const applied = SELECTION_STYLES.aggressive.apply({
    tactical: { captures: true, hangsAfterMove: false },
    heuristics: { captures: true },
    adjustedLoss: 50,
  })
  assert.equal(applied.adjustedLoss, 20)

  // Интеграционная проверка: в режиме human взятие распознаётся.
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['d1e2'], bestMove: 'd1e2' },
    { multipv: 2, score: { type: 'cp', value: -20 }, pv: ['d1d8'], bestMove: 'd1d8' },
  ]
  const aggressive = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', mode: 'human', style: 'aggressive' })
  const capt = aggressive.find((x) => x.move === 'd1d8')
  assert.equal(capt.tactical.captures, true)
})

test('positionalHook: расширяемый хук добавляет дельту к adjustedLoss', () => {
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['d1e2'], bestMove: 'd1e2' },
    { multipv: 2, score: { type: 'cp', value: -40 }, pv: ['d1d2'], bestMove: 'd1d2' },
  ]
  const withHook = rankCandidates(c, {
    fen: HANGING_FEN,
    sideToMove: 'w',
    mode: 'human',
    style: 'balanced',
    positionalHook: (x) => (x.move === 'd1d2' ? 500 : 0),
  })
  const withoutHook = rankCandidates(c, {
    fen: HANGING_FEN,
    sideToMove: 'w',
    mode: 'human',
    style: 'balanced',
  })

  assert.equal(withHook[0].move, 'd1e2')
  const d2Hook = withHook.find((x) => x.move === 'd1d2')
  const d2No = withoutHook.find((x) => x.move === 'd1d2')
  assert.equal(d2Hook.adjustedLoss, d2No.adjustedLoss + 500)
})

test('пустой список кандидатов возвращает []', () => {
  assert.deepEqual(rankCandidates([], { fen: START_FEN }), [])
})

test('реестр стилей содержит ожидаемые ключи', () => {
  assert.ok(SELECTION_STYLES.balanced)
  assert.ok(SELECTION_STYLES.solid)
  assert.ok(SELECTION_STYLES.aggressive)
})

const ITALIAN_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

test('Engine mode: чистая объективная сортировка без эвристик', () => {
  const ranked = rankCandidates(cands, { fen: START_FEN, sideToMove: 'w', mode: 'engine' })
  assert.equal(ranked[0].move, 'e2e4')
  assert.equal(ranked[0].loss, 0)
  assert.equal(ranked[1].loss, 30)
  assert.equal(ranked[2].loss, 80)
  assert.equal(ranked[0].heuristics, null)
  assert.equal(ranked[0].adjustedLoss, ranked[0].loss)
})

test('Human mode: тактически опасный ход понижается', () => {
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['d1e2'], bestMove: 'd1e2' },
    { multipv: 2, score: { type: 'cp', value: -40 }, pv: ['d1d2'], bestMove: 'd1d2' },
  ]
  const ranked = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', mode: 'human' })
  assert.equal(ranked[0].move, 'd1e2')
})

test('Human mode: формируются объяснения для естественных ходов', () => {
  const c = [{ multipv: 1, score: { type: 'cp', value: 0 }, pv: ['b1c3'], bestMove: 'b1c3' }]
  const ranked = rankCandidates(c, { fen: ITALIAN_FEN, sideToMove: 'w', mode: 'human' })
  assert.ok(ranked[0].explanations.length > 0)
  assert.ok(ranked[0].reason.length > 0)
})

test('порог maxLoss исключает плохие альтернативы', () => {
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['d1e2'], bestMove: 'd1e2' },
    { multipv: 2, score: { type: 'cp', value: -300 }, pv: ['d1d2'], bestMove: 'd1d2' },
  ]
  const ranked = rankCandidates(c, { fen: HANGING_FEN, sideToMove: 'w', mode: 'human', maxLoss: 120 })
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].move, 'd1e2')
})

test('Practical mode: ранжирует и возвращает объяснения', () => {
  const c = [
    { multipv: 1, score: { type: 'cp', value: 0 }, pv: ['b1c3'], bestMove: 'b1c3' },
    { multipv: 2, score: { type: 'cp', value: -20 }, pv: ['d2d4'], bestMove: 'd2d4' },
  ]
  const ranked = rankCandidates(c, { fen: ITALIAN_FEN, sideToMove: 'w', mode: 'practical' })
  assert.equal(ranked.length, 2)
  assert.equal(typeof ranked[0].adjustedLoss, 'number')
  assert.ok(Array.isArray(ranked[0].explanations))
})
