import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GameTree, START_FEN } from '../src/gameTree.js'
import { uciToSan, lastMoveSquares, isValidFen, legalTargets, ANALYSIS_MODES } from '../src/analysisUtils.js'

test('uciToSan переводит UCI в SAN', () => {
  assert.equal(uciToSan(START_FEN, 'e2e4'), 'e4')
  assert.equal(uciToSan(START_FEN, 'g1f3'), 'Nf3')
  assert.equal(uciToSan(START_FEN, 'a2a3'), 'a3')
  assert.equal(uciToSan('bad fen', 'e2e4'), null)
  assert.equal(uciToSan(START_FEN, 'xx'), null)
})

test('lastMoveSquares возвращает клетки последнего хода', () => {
  const tree = new GameTree()
  tree.playMove('e4')
  assert.deepEqual(lastMoveSquares(tree.current), ['e2', 'e4'])
  assert.deepEqual(lastMoveSquares(tree.root), [])
})

test('isValidFen проверяет корректность FEN', () => {
  assert.equal(isValidFen(START_FEN), true)
  assert.equal(isValidFen('nonsense'), false)
  assert.equal(isValidFen(''), false)
})

test('legalTargets возвращает клетки-цели для фигуры', () => {
  const targets = legalTargets(START_FEN, 'e2')
  assert.ok(targets.includes('e4'))
  assert.ok(targets.includes('e3'))
  assert.deepEqual(legalTargets(START_FEN, 'e5'), [])
})

test('ANALYSIS_MODES содержит четыре режима', () => {
  const keys = ANALYSIS_MODES.map((m) => m.key)
  assert.deepEqual(keys, ['engine', 'human', 'practical', 'custom'])
})
