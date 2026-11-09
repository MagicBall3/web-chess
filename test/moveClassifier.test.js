import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreToCp, toWhitePerspective, classifyMove } from '../src/moveClassifier.js'

test('scoreToCp: пропускает centipawn как есть', () => {
  assert.equal(scoreToCp({ type: 'cp', value: 35 }), 35)
  assert.equal(scoreToCp({ type: 'cp', value: -120 }), -120)
})

test('scoreToCp: матовые оценки переводятся в большие конечные числа', () => {
  assert.equal(scoreToCp({ type: 'mate', value: 3 }), 100000 - 300)
  assert.equal(scoreToCp({ type: 'mate', value: -1 }), -(100000 - 100))
  assert.equal(scoreToCp(null), 0)
})

test('toWhitePerspective: для белых знак сохраняется, для чёрных инвертируется', () => {
  assert.equal(toWhitePerspective({ type: 'cp', value: 50 }, 'w'), 50)
  assert.equal(toWhitePerspective({ type: 'cp', value: 50 }, 'b'), -50)
  assert.equal(toWhitePerspective({ type: 'mate', value: 2 }, 'b'), -(100000 - 200))
})

test('classifyMove: зевок белых (потеря = prev + curr)', () => {
  const prevEntry = { score: { type: 'cp', value: 100 }, bestMove: 'e2e4' }
  const currEntry = { score: { type: 'cp', value: 300 }, bestMove: 'd2d4' }
  // белые были +100, после хода чёрные +300 -> белые -300, потеря 400
  const label = classifyMove({ prevEntry, currEntry, uciMove: 'g1f3', piece: 'N', hanging: false })
  assert.equal(label, 'blunder')
})

test('classifyMove: зевок чёрных считается корректно (та же потеря)', () => {
  const prevEntry = { score: { type: 'cp', value: 100 }, bestMove: 'g8f6' }
  const currEntry = { score: { type: 'cp', value: 300 }, bestMove: 'e2e4' }
  // чёрные были +100, после хода белые +300 -> чёрные -300, потеря 400
  const label = classifyMove({ prevEntry, currEntry, uciMove: 'b8c6', piece: 'n', hanging: false })
  assert.equal(label, 'blunder')
})

test('classifyMove: лучший ход без потери -> best', () => {
  const prevEntry = { score: { type: 'cp', value: 0 }, bestMove: 'e2e4' }
  const currEntry = { score: { type: 'cp', value: 0 }, bestMove: 'e7e5' }
  const label = classifyMove({ prevEntry, currEntry, uciMove: 'e2e4', piece: 'P', hanging: false })
  assert.equal(label, 'best')
})

test('classifyMove: матовая угроза соперника после хода -> зевок', () => {
  const prevEntry = { score: { type: 'cp', value: 0 }, bestMove: 'g1f3' }
  const currEntry = { score: { type: 'mate', value: 3 }, bestMove: 'a2a3' }
  // после хода соперник ставит мат через 3 хода -> потеря огромная
  const label = classifyMove({ prevEntry, currEntry, uciMove: 'h2h4', piece: 'P', hanging: false })
  assert.equal(label, 'blunder')
})

test('classifyMove: выигрывающий ход не даёт отрицательной потери', () => {
  const prevEntry = { score: { type: 'cp', value: 0 }, bestMove: 'e2e4' }
  const currEntry = { score: { type: 'cp', value: -200 }, bestMove: 'e7e5' }
  // после хода соперник в минусе -> ходящий выиграл материал, потеря = 0
  const label = classifyMove({ prevEntry, currEntry, uciMove: 'd2d4', piece: 'P', hanging: false })
  assert.equal(label, null) // не классифицируется как ошибка
})

test('classifyMove: неточность/ошибка по порогам', () => {
  const mk = (prev, curr) =>
    classifyMove({
      prevEntry: { score: { type: 'cp', value: prev }, bestMove: 'x' },
      currEntry: { score: { type: 'cp', value: curr }, bestMove: 'y' },
      uciMove: 'z',
      piece: 'P',
      hanging: false,
    })
  assert.equal(mk(0, 80), 'inaccuracy') // потеря 80
  assert.equal(mk(0, 180), 'mistake') // потеря 180
  assert.equal(mk(0, 300), 'blunder') // потеря 300
  assert.equal(mk(0, 40), null) // потеря 40 — в пределах нормы
})
