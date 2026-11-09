// strength.js — уровни силы движка Stockfish.
//
// WASM-сборка Stockfish 16 поддерживает UCI_LimitStrength, UCI_Elo и Skill Level
// (проверено по исходнику воркера). Для именованных уровней используем Skill Level
// (0–20, работает во всём диапазоне), для ручной настройки — UCI_LimitStrength +
// UCI_Elo. Maximum = без ограничений (полная сила).

// Именованные уровни силы.
export const STRENGTH_LEVELS = [
  { key: 'beginner', label: 'Beginner', skill: 0 },
  { key: 'casual', label: 'Casual', skill: 3 },
  { key: 'intermediate', label: 'Intermediate', skill: 8 },
  { key: 'advanced', label: 'Advanced', skill: 12 },
  { key: 'expert', label: 'Expert', skill: 15 },
  { key: 'master', label: 'Master', skill: 18 },
  { key: 'maximum', label: 'Maximum', skill: null },
]

// Диапазон ручной настройки Elo.
export const MANUAL_ELO_MIN = 600
export const MANUAL_ELO_MAX = 2800

/**
 * Преобразует настройку силы в опции движка.
 * @param {object|null} strength
 * @param {string} [strength.levelKey] — ключ из STRENGTH_LEVELS
 * @param {number} [strength.manualElo]— ручной Elo (600–2800)
 * @returns {object} опции для AnalysisEngine.analyze():
 *   { skillLevel } | { elo } | {} (Maximum)
 */
export function strengthToEngineOptions(strength) {
  if (!strength) return {}

  if (strength.levelKey) {
    const lvl = STRENGTH_LEVELS.find((l) => l.key === strength.levelKey)
    if (!lvl || lvl.skill == null) return {} // Maximum или неизвестный уровень
    return { skillLevel: lvl.skill }
  }

  if (strength.manualElo != null) {
    const elo = Math.round(Number(strength.manualElo))
    if (Number.isFinite(elo)) return { elo }
  }

  return {}
}

/**
 * Человекочитаемое название текущей настройки силы.
 */
export function strengthLabel(strength) {
  if (!strength) return 'Maximum'
  if (strength.levelKey) {
    const lvl = STRENGTH_LEVELS.find((l) => l.key === strength.levelKey)
    return lvl ? lvl.label : 'Maximum'
  }
  if (strength.manualElo != null) return 'Elo ' + strength.manualElo
  return 'Maximum'
}
