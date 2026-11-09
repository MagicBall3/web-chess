import React, { useRef, useState } from 'react'
import { ANALYSIS_MODES, MODE_DESC } from '../analysisUtils.js'
import { STRENGTH_LEVELS, MANUAL_ELO_MIN, MANUAL_ELO_MAX, strengthLabel } from '../strength.js'

export default function SettingsPanel(props) {
  const {
    open,
    onClose,
    mode,
    setMode,
    strength,
    setStrength,
    depth,
    setDepth,
    multiPv,
    setMultiPv,
    quickMode,
    setQuickMode,
    style,
    setStyle,
    error,
    pgnInput,
    setPgnInput,
    onLoadPgn,
    onLoadPgnFile,
    fenInput,
    setFenInput,
    onLoadFen,
    onFlip,
    onStart,
    onEnd,
    onMainLine,
    onClear,
    analyzing,
    onStop,
  } = props

  const fileRef = useRef(null)
  const [confirmClear, setConfirmClear] = useState(false)

  if (!open) return null

  const handleFile = (e) => {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => onLoadPgnFile(String(reader.result || ''))
    reader.readAsText(f)
    e.target.value = ''
  }

  return (
    <div className="sp-overlay" onClick={onClose}>
      <div className="sp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sp-header">
          <h2>Настройки</h2>
          <button className="tc-btn sp-close" onClick={onClose} aria-label="Закрыть настройки">✕</button>
        </div>

        <div className="sp-body">
          <section className="sp-group">
            <h3>Режим анализа</h3>
            <div className="an-strength-levels">
              {ANALYSIS_MODES.map((m) => (
                <button
                  key={m.key}
                  className={mode === m.key ? 'tc-btn active' : 'tc-btn'}
                  onClick={() => setMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="an-mode-desc">{MODE_DESC[mode]}</p>
            {mode === 'human' && (
              <div className="an-setting-row">
                <span>Стиль рекомендаций:</span>
                <select value={style} onChange={(e) => setStyle(e.target.value)}>
                  <option value="balanced">Сбалансированный</option>
                  <option value="solid">Надёжный</option>
                  <option value="aggressive">Агрессивный</option>
                </select>
              </div>
            )}
          </section>

          <section className="sp-group">
            <h3>Сила движка</h3>
            <div className="an-strength-levels">
              {STRENGTH_LEVELS.map((lvl) => (
                <button
                  key={lvl.key}
                  className={strength && strength.levelKey === lvl.key ? 'tc-btn active' : 'tc-btn'}
                  onClick={() => setStrength({ levelKey: lvl.key })}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
            <div className="an-setting-row">
              <span>Ручной Elo: {strength && strength.manualElo != null ? strength.manualElo : 'выкл'}</span>
              <input
                type="range"
                min={MANUAL_ELO_MIN}
                max={MANUAL_ELO_MAX}
                step={100}
                value={strength && strength.manualElo != null ? strength.manualElo : 1500}
                onChange={(e) => setStrength({ manualElo: Number(e.target.value) })}
              />
            </div>
            <p className="link-text">Текущий уровень: {strengthLabel(strength)}</p>
          </section>

          <section className="sp-group">
            <h3>Глубина и производительность</h3>
            <div className="an-setting-row">
              <span>Глубина: {depth}</span>
              <input
                type="range"
                min={8}
                max={20}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              />
            </div>
            <div className="an-setting-row">
              <span>Вариантов (MultiPV):</span>
              <select value={multiPv} onChange={(e) => setMultiPv(Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
              </select>
            </div>
            <label className="an-check">
              <input type="checkbox" checked={quickMode} onChange={(e) => setQuickMode(e.target.checked)} />
              Быстрый режим (экономия ресурсов на мобильных)
            </label>
            <button className="tc-btn" onClick={onStop} disabled={!analyzing}>Остановить поиск</button>
          </section>

          <section className="sp-group">
            <h3>Импорт</h3>
            <textarea
              rows={4}
              placeholder="Вставьте PGN партии…"
              value={pgnInput}
              onChange={(e) => setPgnInput(e.target.value)}
            />
            <div className="an-import-btns">
              <button onClick={onLoadPgn}>Загрузить PGN</button>
              <button className="secondary" onClick={() => fileRef.current && fileRef.current.click()}>Из файла</button>
              <input
                ref={fileRef}
                type="file"
                accept=".pgn,.txt,text/plain"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
            </div>
            <input
              type="text"
              placeholder="Вставьте FEN позиции…"
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
            />
            <div className="an-import-btns">
              <button onClick={onLoadFen}>Загрузить FEN</button>
            </div>
            {error && <p className="an-error">{error}</p>}
          </section>

          <section className="sp-group">
            <h3>Дополнительно</h3>
            <div className="an-strength-levels">
              <button className="tc-btn" onClick={onFlip}>⟳ Повернуть доску</button>
              <button className="tc-btn" onClick={onStart}>|◀ В начало</button>
              <button className="tc-btn" onClick={onEnd}>В конец ▶|</button>
              <button className="tc-btn" onClick={onMainLine}>К основной линии</button>
              <button
                className="tc-btn"
                onClick={() => {
                  if (confirmClear) {
                    onClear()
                    setConfirmClear(false)
                  } else {
                    setConfirmClear(true)
                  }
                }}
              >
                {confirmClear ? 'Точно очистить?' : 'Очистить анализ'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
