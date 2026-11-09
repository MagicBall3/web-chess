// moveSelector.js — архитектурная основа «человеческого» выбора ходов.
//
// Принимает несколько кандидатных ходов от Stockfish (MultiPV), приводит их
// оценки к единой перспективе, считает потерю относительно лучшего хода и
// учитывает тактическую безопасность. Возвращает ранжированный список.
//
// Стили выбора реализованы как расширяемый реестр модификаторов ранжирования
// (SELECTION_STYLES). Позиционные эвристики пока не реализованы: для них
// предусмотрен хук positionalHook, который по умолчанию возвращает 0 и НЕ
// имитирует фиктивные оценки.

import { Chess } from 'chess.js'
import { isPieceHanging, scoreToCp, toWhitePerspective } from './moveClassifier.js'

// Оценка в перспективе ходящего (выше = лучше для ходящего).
function moverScore(score, sideToMove) {
  const cp = scoreToCp(score)
  return sideToMove === 'w' ? cp : -cp
}

// Стили выбора. Каждый apply получает кандидата и возвращает его же с
// полем adjustedLoss (и, при желании, note). Все модификаторы опираются на
// реальные данные (потеря, висит ли фигура, взятие) — не на выдуманные оценки.
export const SELECTION_STYLES = {
  balanced: {
    label: 'Сбалансированный',
    apply: (c) => ({ ...c, adjustedLoss: c.loss }),
  },
  solid: {
    label: 'Надёжный',
    apply: (c) => ({
      ...c,
      adjustedLoss: c.loss + (c.tactical.hangsAfterMove ? 60 : 0),
      note: c.tactical.hangsAfterMove ? 'Фигура может быть побита' : '',
    }),
  },
  aggressive: {
    label: 'Агрессивный',
    apply: (c) => ({
      ...c,
      adjustedLoss: c.loss - (c.tactical.captures ? 30 : 0),
      note: c.tactical.captures ? 'Взятие' : '',
    }),
  },
}

/**
 * Ранжирование кандидатных ходов.
 * @param {Array} candidates — результаты анализа движка (AnalysisResult[])
 * @param {object} options
 * @param {string} [options.fen]        — FEN позиции (для тактической проверки)
 * @param {'w'|'b'} [options.sideToMove]— сторона, чей ход
 * @param {string} [options.style]       — ключ стиля из SELECTION_STYLES
 * @param {Function} [options.positionalHook] — расширяемый хук позиционных
 *   характеристик: (candidate) => number (дельта к adjustedLoss). По умолчанию 0.
 * @returns {Array} ранжированный список (лучший первый)
 */
export function rankCandidates(candidates, { fen, sideToMove = 'w', style = 'balanced', positionalHook = null } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return []

  const enriched = candidates.map((cand) => {
    const move = cand.bestMove || (cand.pv && cand.pv[0]) || null

    const mine = new Chess(fen)
    let san = null
    let captures = false
    let hangsAfterMove = false

    if (mine && move) {
      try {
        const m = mine.move({
          from: move.slice(0, 2),
          to: move.slice(2, 4),
          promotion: move.slice(4) || undefined,
        })
        if (m) {
          san = m.san
          captures = Boolean(m.captured)
          hangsAfterMove = isPieceHanging(mine, m.to)
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
      note: '',
    }
  })

  // Ранжирование по перспективе ходящего: выше — лучше.
  enriched.sort((a, b) => b.mover - a.mover)
  const bestMover = enriched[0].mover
  for (const c of enriched) {
    c.loss = Math.max(0, bestMover - c.mover)
  }

  const styleDef = SELECTION_STYLES[style] || SELECTION_STYLES.balanced
  for (const c of enriched) {
    const applied = styleDef.apply(c)
    c.adjustedLoss = applied.adjustedLoss != null ? applied.adjustedLoss : c.loss
    c.note = applied.note || c.note || ''

    const delta = positionalHook ? positionalHook(c) : 0
    if (typeof delta === 'number' && delta !== 0) {
      c.adjustedLoss += delta
    }
  }

  // Финальная сортировка: по скорректированной потере, затем по объективной оценке.
  enriched.sort((a, b) => a.adjustedLoss - b.adjustedLoss || b.mover - a.mover)
  return enriched
}
