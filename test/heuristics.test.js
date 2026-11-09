import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzePosition, analyzeCandidate } from '../src/heuristics.js'

// Реальные тестовые позиции.
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4' // открытая
const FRENCH = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' // закрытая
const CHECK_POS = '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1' // ладья даёт шах
const MATERIAL_POS = '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1' // белые с лишней ладьёй
const CASTLED = '5rk1/6pp/8/8/8/8/6PP/5RK1 w - - 0 1' // белые рокированы
const ENDGAME = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1' // несколько равноценных ходов

test('открытая позиция: развитие и контроль центра', () => {
  const h = analyzeCandidate({ fen: ITALIAN, move: 'b1c3', sideToMove: 'w' })
  assert.equal(h.develops, true)
  assert.equal(h.gainsCenter, true)
})

test('шах фиксируется как угроза', () => {
  const h = analyzeCandidate({ fen: CHECK_POS, move: 'e2e7', sideToMove: 'w' })
  assert.equal(h.givesCheck, true)
})

test('материальное преимущество распознаётся', () => {
  const p = analyzePosition(MATERIAL_POS)
  assert.ok(p.material > 0)
})

test('безопасность короля выше после рокировки', () => {
  const castled = analyzePosition(CASTLED)
  const open = analyzePosition(MATERIAL_POS)
  assert.ok(castled.kingSafe > open.kingSafe)
})

test('закрытая позиция: профиль считается', () => {
  const p = analyzePosition(FRENCH)
  assert.equal(typeof p.centerControl, 'number')
  assert.equal(typeof p.kingSafe, 'number')
  assert.equal(typeof p.material, 'number')
})

test('эндшпиль с равноценными ходами: кандидат анализируется', () => {
  const h = analyzeCandidate({ fen: ENDGAME, move: 'e1d2', sideToMove: 'w' })
  assert.ok(h)
  assert.equal(typeof h.safe, 'boolean')
  assert.ok(Array.isArray(h.explanations))
})

test('нелегальный ход возвращает null', () => {
  const h = analyzeCandidate({ fen: ITALIAN, move: 'e7e5', sideToMove: 'w' })
  assert.equal(h, null)
})
