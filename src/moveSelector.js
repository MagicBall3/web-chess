// moveSelector.js — ранжирование кандидатных ходов по режимам анализа.
//
// Режимы:
//   engine    — чисто объективная сортировка по оценке движка (без эвристик).
//   human     — человеческие критерии: естественность, развитие, безопасность,
//               тактическая безопасность + стиль. Объяснения.
//   practical — практические критерии: устойчивость, простота реализации,
//               безопасность короля, создание угроз. Объяснения.
//
// Все эвристики берутся из heuristics.js и опираются на реальную позицию.

import { Chess } from 'chess.js'
import { isPieceHanging, scoreToCp, toWhitePerspective } from './moveClassifier.js'
import { analyzeCandidate } from './heuristics.js'

// Оценка в перспективе ходящего (выше = лучше для ходящего).
function moverScore(score, sideToMove) {
  const cp = scoreToCp(score)
  return sideToMove === 'w' ? cp : -cp
}

// Стили человеческого выбора (модификаторы ранжирования в режиме human).
export const SELECTION_STYLES = {
  balanced: {
    label: 'Сбалансированный',
    apply: (c) => ({ ...c, adjustedLoss: c.adjustedLoss }),
  },
  solid: {
    label: 'Надёжный',
    apply: (c) => ({
      ...c,
      adjustedLoss: c.adjustedLoss + (c.heuristics && c.heuristics.hangsAfterMove ? 60 : 0),
      note: c.heuristics && c.heuristics.hangsAfterMove ? 'Фигура может быть побита' : '',
    }),
  },
  aggressive: {
    label: 'Агрессивный',
    apply: (c) => ({
      ...c,
      adjustedLoss: c.adjustedLoss - (c.heuristics && c.heuristics.captures ? 30 : 0),
      note: c.heuristics && c.heuristics.captures ? 'Взятие' : '',
    }),
  },
}

// Обогащение кандидата базовыми полями (mover, loss, san, tactical).
function enrich(cand, fen, sideToMove) {
  const move = cand.bestMove || (cand.pv && cand.pv[0]) || null
  const chess = new Chess(fen)
  let san = null
  let captures = false
  let hangsAfterMove = false

  if (move) {
    try {
      const m = chess.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move.slice(4) || undefined,
      })
      if (m) {
        san = m.san
        captures = Boolean(m.captured)
        hangsAfterMove = isPieceHanging(chess, m.to)
      }
    } catch {
      // нелегальный ход — оставляем как есть
    }
  }

  return {
    multipv: cand.multipv,
    move,
    san,
    scoreWhite: toWhitePerspective(cand.score, sideToMove),
    mover: moverScore(cand.score, sideToMove),
    depth: cand.depth,
    pv: cand.pv,
    tactical: { hangsAfterMove, captures },
    loss: 0,
    adjustedLoss: 0,
    reason: '',
    explanations: [],
    heuristics: null,
  }
}

// Человеческое ранжирование.
function rankHuman(enriched, { maxLoss, style, positionalHook }) {
  const pool = enriched.filter((c) => c.loss <= maxLoss)
  const list = pool.length ? pool : [enriched[0]]

  for (const c of list) {
    const h = c.heuristics
    let adj = c.loss
    if (h) {
      if (h.develops) adj -= 40
      if (h.gainsCenter) adj -= 30
      if (h.improvesActivity) adj -= 25
      if (h.kingSafetyDelta > 0) adj -= 35
      if (h.givesCheck) adj -= 20
      if (h.captures) adj -= 15
      if (h.attacksUndefended) adj -= 25
      if (h.hangsAfterMove) adj += 80
    }
    const styleDef = SELECTION_STYLES[style] || SELECTION_STYLES.balanced
    const applied = styleDef.apply({ ...c, adjustedLoss: adj })
    adj = applied.adjustedLoss != null ? applied.adjustedLoss : adj
    if (positionalHook) {
      const d = positionalHook(c)
      if (typeof d === 'number') adj += d
    }
    c.adjustedLoss = Math.max(0, adj)
    c.explanations = h ? h.explanations : []
    c.reason = c.explanations.join(', ')
    c.note = applied.note || ''
  }

  list.sort((a, b) => a.adjustedLoss - b.adjustedLoss || b.mover - a.mover)
  return list
}

// Практическое ранжирование.
function rankPractical(enriched, { maxLoss, positionalHook }) {
  const pool = enriched.filter((c) => c.loss <= maxLoss)
  const list = pool.length ? pool : [enriched[0]]

  for (const c of list) {
    const h = c.heuristics
    let adj = c.loss
    if (h) {
      if (h.hangsAfterMove) adj += 100
      if (h.kingSafetyDelta < 0) adj += 60
      if (!h.safe) adj += 40
      if (h.develops) adj -= 30
      if (h.gainsCenter) adj -= 25
      if (h.attacksUndefended) adj -= 30
      if (h.captures) adj += 10 // взятия ведут к форсированным линиям
      if (h.givesCheck) adj += 5 // шахи тоже могут быть форсированными
    }
    if (positionalHook) {
      const d = positionalHook(c)
      if (typeof d === 'number') adj += d
    }
    c.adjustedLoss = Math.max(0, adj)
    c.explanations = h ? h.explanations : []
    c.reason = c.explanations.join(', ')
    c.note = ''
  }

  list.sort((a, b) => a.adjustedLoss - b.adjustedLoss || b.mover - a.mover)
  return list
}

/**
 * Ранжирование кандидатных ходов.
 * @param {Array} candidates — результаты анализа движка (AnalysisResult[])
 * @param {object} options
 * @param {string} options.fen — FEN позиции
 * @param {'w'|'b'} [options.sideToMove] — сторона, чей ход
 * @param {'engine'|'human'|'practical'} [options.mode] — режим анализа
 * @param {number} [options.maxLoss] — порог допустимой потери (cp) для human/practical
 * @param {string} [options.style] — стиль человеческого выбора
 * @param {Function} [options.positionalHook] — расширяемый хук
 * @returns {Array} ранжированный список
 */
export function rankCandidates(
  candidates,
  { fen, sideToMove = 'w', mode = 'engine', maxLoss = 120, style = 'balanced', positionalHook = null } = {}
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return []

  const enriched = candidates.map((cand) => enrich(cand, fen, sideToMove))
  enriched.sort((a, b) => b.mover - a.mover)
  const bestMover = enriched[0].mover
  for (const c of enriched) {
    c.loss = Math.max(0, bestMover - c.mover)
  }

  if (mode === 'engine') {
    // Чисто объективный порядок: без эвристик.
    for (const c of enriched) {
      c.adjustedLoss = c.loss
      c.reason = ''
      c.explanations = []
    }
    return enriched
  }

  // human / practical: вычисляем реальные эвристики.
  for (const c of enriched) {
    c.heuristics = analyzeCandidate({ fen, move: c.move, sideToMove })
  }

  if (mode === 'practical') {
    return rankPractical(enriched, { maxLoss, positionalHook })
  }

  return rankHuman(enriched, { maxLoss, style, positionalHook })
}
