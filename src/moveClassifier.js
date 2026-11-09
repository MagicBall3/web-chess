const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

// Переводим оценку (включая маты) в единое число в сантипешках.
// Для мата: mate N означает «мат через N ходов для стороны, чей ход».
// Положительное значение — сторона, чей ход, ставит мат.
export function scoreToCp(score) {
  if (!score) return 0
  if (score.type === 'mate') {
    const sign = score.value > 0 ? 1 : -1
    return sign * (100000 - Math.abs(score.value) * 100)
  }
  return score.value
}

// Приводим оценку к перспективе белых.
// sideToMove: 'w' | 'b' — сторона, чей ход в оцениваемой позиции.
// Оценки Stockfish даны с точки зрения стороны, чей ход, поэтому для чёрных
// знак инвертируется.
export function toWhitePerspective(score, sideToMove) {
  const cp = scoreToCp(score)
  return sideToMove === 'w' ? cp : -cp
}

// Потеря оценки за ход (в сантипешках).
// Оценки приходят от Stockfish в перспективе стороны, чей ход:
//   prevScore — оценка позиции ДО хода (ходит сторона, делающая ход);
//   currScore — оценка позиции ПОСЛЕ хода (ходит уже соперник).
// Чтобы сравнить обе в перспективе ходящего, оценку после хода отрицаем
// (перспектива соперника противоположна перспективе ходящего).
// Потеря = moverBefore - moverAfter = prev - (-curr) = prev + curr.
// max(0, …) исключает отрицательную «потерю» для выигрывающих ходов.
function computeLoss(prevScore, currScore) {
  const moverBefore = scoreToCp(prevScore)
  const moverAfter = -scoreToCp(currScore)
  return Math.max(0, moverBefore - moverAfter)
}

// Проверяем, атакована ли клетка соперником сразу после хода (грубая эвристика "висит ли фигура")
export function isPieceHanging(gameAfterMove, square) {
  const oppMoves = gameAfterMove.moves({ verbose: true })
  return oppMoves.some((m) => m.to === square)
}

export function classifyMove({ prevEntry, currEntry, uciMove, piece, hanging }) {
  if (!prevEntry || !currEntry) return null

  const loss = computeLoss(prevEntry.score, currEntry.score)
  const isTopMove = prevEntry.bestMove === uciMove
  const pieceValue = PIECE_VALUES[piece] || 0
  const isSacrifice = hanging && pieceValue >= 3

  if (isTopMove && isSacrifice && loss <= 30) return 'brilliant'
  if (isTopMove && loss <= 20) return 'best'
  if (loss <= 60) return null
  if (loss <= 120) return 'inaccuracy'
  if (loss <= 250) return 'mistake'
  return 'blunder'
}

export const MOVE_ICONS = {
  brilliant: '💎',
  best: '⭐',
  inaccuracy: '🟡',
  mistake: '🟠',
  blunder: '🔴',
}

export const MOVE_LABELS = {
  brilliant: 'Изумрудный ход',
  best: 'Замечательный ход',
  inaccuracy: 'Неточность',
  mistake: 'Ошибка',
  blunder: 'Зевок',
}
