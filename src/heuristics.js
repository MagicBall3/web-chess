// heuristics.js — реальные позиционные и тактические эвристики для анализатора.
//
// Все сигналы вычисляются из фактической позиции через chess.js. Никаких
// «выдуманных» оценок: если характеристика не может быть достоверно проверена,
// она не включается в объяснение.

import { Chess } from 'chess.js'

const CENTER_SQUARES = ['d4', 'd5', 'e4', 'e5']

// Домашние поля минорных фигур (конь/слон) по цвету.
const MINOR_HOME = {
  w: ['b1', 'g1', 'c1', 'f1'],
  b: ['b8', 'g8', 'c8', 'f8'],
}

// Сколько центральных полей атакует сторона color.
function countCenterAttacks(chess, color) {
  let count = 0
  for (const sq of CENTER_SQUARES) {
    if (chess.attackers(sq, color).length > 0) count++
  }
  return count
}

// Оценка безопасности короля: пешечное прикрытие + бонус за рокировку.
function kingSafetyScore(chess, color) {
  const board = chess.board()
  let kingSq = null
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f]
      if (p && p.type === 'k' && p.color === color) kingSq = p.square
    }
  }
  if (!kingSq) return 0

  const file = kingSq.charCodeAt(0) - 97
  const rank = parseInt(kingSq[1], 10)
  const dir = color === 'w' ? 1 : -1
  let score = 0

  for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
    const r = rank + dir
    if (r >= 1 && r <= 8) {
      const p = chess.get(String.fromCharCode(97 + f) + r)
      if (p && p.type === 'p' && p.color === color) score += 2
    }
  }

  if (color === 'w' && (kingSq === 'g1' || kingSq === 'c1')) score += 3
  if (color === 'b' && (kingSq === 'g8' || kingSq === 'c8')) score += 3

  return score
}

// Висит ли фигура на поле square (может ли соперник её побить).
function isHanging(chess, square) {
  return chess.moves({ verbose: true }).some((m) => m.to === square)
}

// Атакует ли фигура с поля square незащищённую фигуру соперника.
function attacksUndefendedPiece(chess, square, color) {
  const targets = chess.moves({ square, verbose: true })
  for (const t of targets) {
    const targetPiece = chess.get(t.to)
    if (targetPiece && targetPiece.color !== color) {
      const defenders = chess.attackers(t.to, targetPiece.color)
      if (defenders.length === 0) return true
    }
  }
  return false
}

// Суммарная материальная ценность фигур стороны color.
function materialCount(chess, color) {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
  let total = 0
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = chess.board()[r][f]
      if (p && p.color === color) total += values[p.type] || 0
    }
  }
  return total
}

/**
 * Профиль позиции для стороны, чей ход.
 */
export function analyzePosition(fen) {
  const chess = new Chess(fen)
  const color = chess.turn()
  return {
    inCheck: chess.inCheck(),
    kingSafe: kingSafetyScore(chess, color),
    centerControl: countCenterAttacks(chess, color),
    material: materialCount(chess, color),
  }
}

/**
 * Сигналы для одного кандидатного хода.
 * @param {object} p
 * @param {string} p.fen      — позиция до хода
 * @param {string} p.move     — ход в UCI (например "e2e4")
 * @param {'w'|'b'} p.sideToMove — сторона, чей ход
 * @returns {object|null} сигналы + объяснения (null, если ход нелегален)
 */
export function analyzeCandidate({ fen, move, sideToMove }) {
  if (!move || move.length < 4) return null

  const from = move.slice(0, 2)
  const to = move.slice(2, 4)
  const promo = move.slice(4) || undefined

  const before = new Chess(fen)
  const movingPiece = before.get(from)
  if (!movingPiece) return null
  const type = movingPiece.type
  const color = sideToMove

  const mobilityBefore = before.moves({ square: from, verbose: true }).length
  const centerBefore = countCenterAttacks(before, color)
  const kingSafeBefore = kingSafetyScore(before, color)

  const after = new Chess(fen)
  const played = after.move({ from, to, promotion: promo })
  if (!played) return null

  const mobilityAfter = after.moves({ square: to, verbose: true }).length
  const centerAfter = countCenterAttacks(after, color)
  const kingSafeAfter = kingSafetyScore(after, color)
  const givesCheck = after.inCheck()
  const captures = Boolean(played.captured)
  const hangsAfterMove = isHanging(after, to)
  const attacksUndefended = attacksUndefendedPiece(after, to, color)

  const develops = (type === 'n' || type === 'b') && MINOR_HOME[color].includes(from)
  const gainsCenter = centerAfter > centerBefore
  const improvesActivity = mobilityAfter > mobilityBefore
  const safe = !hangsAfterMove

  const explanations = []
  if (develops) explanations.push('развивает фигуру')
  if (gainsCenter) explanations.push('усиливает контроль центра')
  if (improvesActivity) explanations.push('повышает активность фигуры')
  if (kingSafeAfter > kingSafeBefore) explanations.push('улучшает безопасность короля')
  if (givesCheck) explanations.push('создаёт шах')
  if (captures) explanations.push('берёт фигуру')
  if (attacksUndefended) explanations.push('атакует незащищённую фигуру')
  if (safe) explanations.push('тактически устойчив')

  return {
    develops,
    gainsCenter,
    improvesActivity,
    kingSafeAfter,
    kingSafetyDelta: kingSafeAfter - kingSafeBefore,
    givesCheck,
    captures,
    attacksUndefended,
    hangsAfterMove,
    safe,
    explanations,
  }
}
