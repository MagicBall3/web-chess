const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

// Переводим оценку (включая маты) в единое число в сантипешках
export function scoreToCp(score) {
  if (!score) return 0
  if (score.type === 'mate') {
    const sign = score.value > 0 ? 1 : -1
    return sign * (100000 - Math.abs(score.value) * 100)
  }
  return score.value
}

// Проверяем, атакована ли клетка соперником сразу после хода (грубая эвристика "висит ли фигура")
export function isPieceHanging(gameAfterMove, square) {
  const oppMoves = gameAfterMove.moves({ verbose: true })
  return oppMoves.some((m) => m.to === square)
}

export function classifyMove({ prevEntry, currEntry, uciMove, piece, hanging }) {
  if (!prevEntry || !currEntry) return null

  const loss = scoreToCp(prevEntry.score) + scoreToCp(currEntry.score)
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
