import { Chess } from 'chess.js'

export const ANALYSIS_MODES = [
  { key: 'engine', label: 'Engine' },
  { key: 'human', label: 'Human' },
  { key: 'practical', label: 'Practical' },
  { key: 'custom', label: 'Custom Strength' },
]

export const MODE_DESC = {
  engine: 'Объективный анализ: сильнейшие ходы Stockfish без эвристик.',
  human: 'Естественные и понятные ходы с объяснением причин.',
  practical: 'Практически полезные решения: устойчивые и реализуемые.',
  custom: 'Анализ с настройкой силы движка.',
}

export function uciToSan(fen, uci) {
  if (!fen || !uci || uci.length < 4) return null
  try {
    const chess = new Chess(fen)
    const m = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || undefined,
    })
    return m ? m.san : null
  } catch {
    return null
  }
}

export function lastMoveSquares(node) {
  if (!node || !node.move) return []
  return [node.move.from, node.move.to]
}

export function isValidFen(fen) {
  try {
    new Chess(fen)
    return true
  } catch {
    return false
  }
}

export function legalTargets(fen, square) {
  if (!fen || !square) return []
  try {
    const chess = new Chess(fen)
    return chess.moves({ square, verbose: true }).map((m) => m.to)
  } catch {
    return []
  }
}
