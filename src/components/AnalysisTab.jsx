import React, { useEffect, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import { GameTree } from '../gameTree.js'
import { AnalysisEngine } from '../analysisEngine.js'
import { rankCandidates } from '../moveSelector.js'
import { classifyMove, MOVE_ICONS } from '../moveClassifier.js'
import { strengthToEngineOptions, strengthLabel } from '../strength.js'
import { uciToSan, lastMoveSquares, legalTargets, isValidFen } from '../analysisUtils.js'
import SettingsPanel from './SettingsPanel.jsx'

const DEFAULT_DEPTH = 14

function evalToWhitePercent(score) {
  if (!score) return 50
  const cp = score.type === 'mate' ? Math.sign(score.value) * 100000 : score.value
  return 50 - 50 * Math.tanh(cp / 400)
}

function formatScore(score) {
  if (!score) return '—'
  if (score.type === 'mate') return 'Мат ' + Math.abs(score.value)
  const cp = Math.round(score.value / 100)
  return (cp > 0 ? '+' : '') + cp
}

// Цвет линии графика: белый при преимуществе белых, чёрный при преимуществе чёрных.
function evalColor(cp) {
  if (!cp && cp !== 0) return '#888'
  const maxCp = 600
  const t = Math.max(0, Math.min(1, (cp + maxCp) / (2 * maxCp)))
  const v = Math.round(120 + t * 135)
  return `rgb(${v},${v},${v})`
}

// Оценка в сантипешках для отображения.
function evalCp(score) {
  if (!score) return 0
  if (score.type === 'mate') return Math.sign(score.value) * 10000
  return score.value
}

export default function AnalysisTab({ initialPgn = null, onExit = null }) {
  const treeRef = useRef(new GameTree())
  const engineRef = useRef(null)

  const [node, setNode] = useState(treeRef.current.root)
  const [mode, setMode] = useState('engine')
  const [multiPv, setMultiPv] = useState(3)
  const [depth, setDepth] = useState(DEFAULT_DEPTH)
  const [strength, setStrength] = useState(null)
  const [style, setStyle] = useState('balanced')
  const [quickMode, setQuickMode] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [pgnInput, setPgnInput] = useState('')
  const [fenInput, setFenInput] = useState('')
  const [reviewAnnotations, setReviewAnnotations] = useState({})
  const [evals, setEvals] = useState([]) // оценка по полуходам: evals[ply] = score
  const [showArrow, setShowArrow] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [orientation, setOrientation] = useState('white')
  const [selectedSquare, setSelectedSquare] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // Загрузка начальной партии (если передана извне).
  useEffect(() => {
    if (initialPgn) {
      try {
        treeRef.current.loadPgn(initialPgn)
        setNode(treeRef.current.current)
      } catch {
        /* некорректный PGN игнорируем */
      }
    }
  }, [initialPgn])

  // Корректно закрываем движок при уходе с вкладки.
  useEffect(() => {
    return () => {
      if (engineRef.current) engineRef.current.terminate()
    }
  }, [])

  const getEngine = () => {
    if (!engineRef.current) engineRef.current = new AnalysisEngine()
    return engineRef.current
  }

  const fen = node.fen
  const sideToMove = fen.split(' ')[1] || 'w'
  const history = treeRef.current.getHistory()
  const isRecommendationMode = mode === 'human' || mode === 'practical'

  const effDepth = quickMode ? Math.min(depth, 10) : depth
  const effMultiPv = quickMode ? Math.min(multiPv, 3) : multiPv

  // Автоанализ текущей позиции.
  useEffect(() => {
    let cancelled = false
    const eng = getEngine()
    setAnalyzing(true)

    const opts = { fen, depth: effDepth, multiPv: effMultiPv }
    if (mode === 'custom') Object.assign(opts, strengthToEngineOptions(strength))

    ;(async () => {
      try {
        const res = await eng.analyze(opts)
        if (cancelled) return
        const evalScore = res[0] ? res[0].score : null
        const bestMove = res[0] ? res[0].bestMove : null

        // Сохраняем оценку для текущего полухода (для графика).
        const currentPly = history.length
        setEvals((prev) => {
          const next = [...prev]
          next[currentPly] = evalScore
          return next
        })

        if (mode === 'human') {
          const ranked = rankCandidates(res, { fen, sideToMove, mode: 'human', style })
          setAnalysis({ candidates: res, ranked, eval: evalScore, bestMove })
        } else if (mode === 'practical') {
          const ranked = rankCandidates(res, { fen, sideToMove, mode: 'practical' })
          setAnalysis({ candidates: res, ranked, eval: evalScore, bestMove })
        } else {
          // engine / custom — объективно
          setAnalysis({ candidates: res, eval: evalScore, bestMove })
        }
      } catch (e) {
        if (!cancelled) setError(String(e.message || e))
      } finally {
        if (!cancelled) setAnalyzing(false)
      }
    })()

    return () => {
      cancelled = true
      eng.abort()
    }
  }, [fen, mode, effDepth, effMultiPv, strength, style])

  // --- действия с деревом ---

  const playMoveFromUci = (uci) => {
    if (!uci || uci.length < 4) return false
    const legal = treeRef.current.legalMoves()
    const match = legal.find((m) => m.from === uci.slice(0, 2) && m.to === uci.slice(2, 4))
    if (!match) return false
    try {
      const played = treeRef.current.playMove({
        from: match.from,
        to: match.to,
        promotion: match.promotion ? 'q' : undefined,
      })
      if (played) {
        setNode(played)
        setAnalysis(null)
        setReviewAnnotations({})
        setExpandedIdx(null)
        setSelectedSquare(null)
      }
      return !!played
    } catch {
      return false
    }
  }

  const handleDrop = (source, target) => playMoveFromUci(source + target)

  const handleSquareClick = (square) => {
    if (selectedSquare && square !== selectedSquare) {
      if (playMoveFromUci(selectedSquare + square)) return
    }
    setSelectedSquare((prev) => (prev === square ? null : square))
  }

  const goToStart = () => { treeRef.current.goToStart(); setNode(treeRef.current.current) }
  const goToEnd = () => { treeRef.current.goToEnd(); setNode(treeRef.current.current) }
  const goPrev = () => { treeRef.current.prev(); setNode(treeRef.current.current) }
  const goNext = () => { treeRef.current.next(); setNode(treeRef.current.current) }
  const goToMainLine = () => { treeRef.current.goToMainLine(); setNode(treeRef.current.current) }
  const resetToStart = () => { treeRef.current.reset(); setNode(treeRef.current.root) }

  const goToNode = (nd) => {
    treeRef.current.goToNode(nd)
    setNode(nd)
  }

  const goToPly = (ply) => {
    const moves = treeRef.current.getHistory()
    treeRef.current.goToStart()
    const limit = Math.max(0, Math.min(ply, moves.length))
    for (let k = 0; k < limit; k++) {
      const m = moves[k]
      const child = treeRef.current.childrenOf(treeRef.current).find(
        (c) =>
          c.move.from === m.from &&
          c.move.to === m.to &&
          (c.move.promotion || '') === (m.promotion || '')
      )
      if (child) treeRef.current.current = child
      else break
    }
    setNode(treeRef.current.current)
  }

  const applyLoaded = () => {
    setAnalysis(null)
    setReviewAnnotations({})
    setExpandedIdx(null)
    setSelectedSquare(null)
    setError('')
  }

  const loadPgn = () => {
    try {
      treeRef.current.loadPgn(pgnInput)
      setNode(treeRef.current.current)
      setPgnInput('')
      applyLoaded()
    } catch (e) {
      setError('Не удалось загрузить PGN: ' + e.message)
    }
  }

  const loadPgnFile = (text) => {
    setPgnInput(text)
    try {
      treeRef.current.loadPgn(text)
      setNode(treeRef.current.current)
      setPgnInput('')
      applyLoaded()
    } catch (e) {
      setError('Не удалось загрузить PGN из файла: ' + e.message)
    }
  }

  const loadFen = () => {
    if (!isValidFen(fenInput)) {
      setError('Некорректный FEN')
      return
    }
    try {
      const chess = new Chess(fenInput)
      treeRef.current.loadFen(chess.fen())
      setNode(treeRef.current.root)
      setFenInput('')
      applyLoaded()
    } catch {
      setError('Некорректный FEN')
    }
  }

  const runReview = async () => {
    const eng = getEngine()
    setAnalyzing(true)
    setError('')
    try {
      const pathNodes = []
      let n = treeRef.current.root
      while (n.mainChild) {
        pathNodes.push(n.mainChild)
        n = n.mainChild
      }

      const evals = []
      evals.push((await eng.analyze({ fen: treeRef.current.root.fen, depth: effDepth, multiPv: 1 }))[0])
      const annotations = {}
      for (let i = 0; i < pathNodes.length; i++) {
        const nd = pathNodes[i]
        const res = (await eng.analyze({ fen: nd.fen, depth: effDepth, multiPv: 1 }))[0]
        evals.push(res)
        const mv = nd.move
        const label = classifyMove({
          prevEntry: evals[i],
          currEntry: res,
          uciMove: mv.from + mv.to + (mv.promotion || ''),
          piece: mv.piece,
          hanging: false,
        })
        if (label) annotations[i + 1] = label
      }
      setReviewAnnotations(annotations)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setAnalyzing(false)
    }
  }

  const handleClear = () => {
    resetToStart()
    applyLoaded()
  }

  // --- производные для отрисовки ---

  const arrows = []
  if (showArrow) {
    const bm = isRecommendationMode && analysis && analysis.ranked && analysis.ranked[0]
      ? analysis.ranked[0].move
      : analysis && analysis.bestMove
    if (bm && bm.length >= 4) arrows.push([bm.slice(0, 2), bm.slice(2, 4)])
  }

  const boardStyles = {}
  if (selectedSquare) boardStyles[selectedSquare] = { background: 'rgba(255,220,80,0.5)' }
  for (const sq of lastMoveSquares(node)) {
    boardStyles[sq] = { background: 'rgba(108,92,231,0.4)' }
  }
  if (selectedSquare) {
    for (const t of legalTargets(fen, selectedSquare)) {
      boardStyles[t] = { boxShadow: 'inset 0 0 0 4px rgba(255,255,255,0.55)' }
    }
  }
  let recMove = null
  if (isRecommendationMode && analysis && analysis.ranked && analysis.ranked[0]) recMove = analysis.ranked[0].move
  else if (analysis && analysis.bestMove) recMove = analysis.bestMove
  if (recMove && recMove.length >= 4) {
    const col = isRecommendationMode ? 'rgba(0,200,0,0.35)' : 'rgba(0,150,255,0.3)'
    if (!boardStyles[recMove.slice(0, 2)]) boardStyles[recMove.slice(0, 2)] = { background: col }
    if (!boardStyles[recMove.slice(2, 4)]) boardStyles[recMove.slice(2, 4)] = { background: col }
  }

  const bestMoveSan =
    isRecommendationMode && analysis && analysis.ranked && analysis.ranked[0] && analysis.ranked[0].san
      ? analysis.ranked[0].san
      : uciToSan(fen, analysis && analysis.bestMove)

  const pairs = []
  for (let i = 0; i < history.length; i += 2) {
    pairs.push({
      num: i / 2 + 1,
      white: history[i],
      black: history[i + 1],
      whitePly: i + 1,
      blackPly: i + 2,
    })
  }

  const branches = treeRef.current.childrenOf(node)

  // Рисует SVG-график оценки позиции по сохранённым evals.
  function renderEvalGraph() {
    const points = evals
      .map((score, ply) => (score ? { ply, score } : null))
      .filter(Boolean)
    if (points.length < 2) return <div className="an-eval-empty">Нет данных для графика</div>

    const width = 340
    const height = 100
    const pad = 24
    const plotW = width - pad * 2
    const plotH = height - 24
    const maxCp = 600
    const zeroY = height / 2
    const maxPly = Math.max(points[points.length - 1].ply, 1)

    const toX = (ply) => pad + (ply / maxPly) * plotW
    const toY = (cp) => {
      const clamped = Math.max(-maxCp, Math.min(maxCp, cp))
      return zeroY - (clamped / maxCp) * (plotH / 2)
    }

    // Линия графика
    let path = ''
    points.forEach((p, i) => {
      const x = toX(p.ply)
      const y = toY(evalCp(p.score))
      path += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' '
    })

    // Текущая позиция (последняя точка)
    const last = points[points.length - 1]
    const cx = toX(last.ply)
    const cy = toY(evalCp(last.score))

    return (
      <svg width={width} height={height} className="an-eval-svg" role="img" aria-label="График оценки позиции">
        <defs>
          <linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d2d44" />
            <stop offset="50%" stopColor="#1a1a2e" />
            <stop offset="100%" stopColor="#2d2d44" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={width} height={height} fill="url(#evalGrad)" rx={6} />
        {/* Нулевая линия */}
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#444" strokeWidth={1} strokeDasharray="4 4" />
        {/* Линия оценки */}
        <path d={path} stroke="#e8e8f0" strokeWidth={2} fill="none" />
        {/* Точка текущей позиции */}
        <circle cx={cx} cy={cy} r={4} fill="#6c5ce7" stroke="#fff" strokeWidth={1.5} />
        {/* Подписи */}
        <text x={pad} y={14} fontSize="10" fill="#888" fontFamily="monospace">+3</text>
        <text x={pad} y={height - 6} fontSize="10" fill="#888" fontFamily="monospace">-3</text>
        <text x={width - pad - 20} y={14} fontSize="10" fill="#888" fontFamily="monospace" textAnchor="end">{last.ply}</text>
        <text x={pad} y={14} fontSize="10" fill="#888" fontFamily="monospace" textAnchor="start">0</text>
      </svg>
    )
  }

  return (
    <div className="an-layout">
      <div className="an-topbar">
        <h2>Анализ партии</h2>
        <div className="an-topbar-actions">
          <button className="tc-btn an-settings-btn" onClick={() => setShowSettings(true)}>
            ⚙ Настройки
          </button>
          {onExit && <button className="tc-btn" onClick={onExit}>В меню</button>}
        </div>
      </div>

      <div className="an-main">
        <div className="an-col-board">
          <div className="an-board-wrap">
            <Chessboard
              position={fen}
              boardOrientation={orientation}
              arePiecesDraggable
              onPieceDrop={handleDrop}
              onSquareClick={handleSquareClick}
              customSquareStyles={boardStyles}
              customArrows={arrows}
              customDarkSquareStyle={{ backgroundColor: '#3d3d5c' }}
              customLightSquareStyle={{ backgroundColor: '#b8b8d0' }}
            />
          </div>

          <div className="an-info-strip">
            <div className="an-eval-box">
              <span className={`an-engine-dot${analyzing ? ' active' : ''}`} />
              <span className="an-eval-num">{formatScore(analysis ? analysis.eval : null)}</span>
            </div>
            <div className="an-bestmove">
              {bestMoveSan ? `Рекомендация: ${bestMoveSan}` : 'Рекомендация: —'}
            </div>
            <div className="an-state">{analyzing ? 'Анализирую…' : 'Готово'}</div>
          </div>

          {/* График оценки позиции */}
          <div className="an-eval-graph-wrap">
            <div className="an-eval-graph-label">
              <span>Оценка позиции</span>
              <span className="an-eval-graph-current">
                {analysis?.eval ? formatScore(analysis.eval) : '—'}
              </span>
            </div>
            <div className="an-eval-graph">
              {renderEvalGraph()}
            </div>
          </div>

          <div className="an-navrow">
            <button className="tc-btn" onClick={goToStart} title="В начало">|◀</button>
            <button className="tc-btn" onClick={goPrev} title="Назад">◀</button>
            <button className="tc-btn" onClick={goNext} title="Вперёд">▶</button>
            <button className="tc-btn" onClick={goToEnd} title="В конец">▶|</button>
            <button
              className={showArrow ? 'tc-btn active' : 'tc-btn'}
              onClick={() => setShowArrow((v) => !v)}
              title="Стрелка лучшего хода"
            >
              ⇶
            </button>
            <button
              className="tc-btn"
              onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
              title="Повернуть доску"
            >
              ⟳
            </button>
          </div>
        </div>

        <div className="an-col-side">
          {isRecommendationMode && analysis && analysis.ranked && (
            <div className="an-panel">
              <h3>{mode === 'human' ? `Рекомендации (${style})` : 'Практические рекомендации'}</h3>
              {analysis.ranked.map((r, idx) => (
                <div key={idx} className="an-cand clickable" onClick={() => playMoveFromUci(r.move)}>
                  <span className="an-cand-num">{idx + 1}.</span>
                  <span className="an-cand-pv">{r.san || r.move}</span>
                  <span className="an-cand-score">Потеря: {r.loss}</span>
                  <button
                    className="an-expand tc-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedIdx(expandedIdx === idx ? null : idx)
                    }}
                  >
                    {expandedIdx === idx ? 'Скрыть' : 'Почему?'}
                  </button>
                  {expandedIdx === idx && (
                    <div className="an-reason">
                      {r.explanations && r.explanations.length ? (
                        r.explanations.map((x, i) => <div key={i}>• {x}</div>)
                      ) : (
                        <div>Нет достоверных объяснений.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {(mode === 'engine' || mode === 'custom') && analysis && analysis.candidates && (
            <div className="an-panel">
              <h3>
                {mode === 'custom' ? `Кандидаты (${strengthLabel(strength)})` : 'Кандидатные ходы (Engine)'}
              </h3>
              {analysis.candidates.map((c) => (
                <div key={c.multipv} className="an-cand clickable" onClick={() => playMoveFromUci(c.bestMove)}>
                  <span className="an-cand-num">{c.multipv}.</span>
                  <span className="an-cand-pv">{c.bestMove} · {c.pv.join(' ')}</span>
                  <span className="an-cand-score">{formatScore(c.score)}</span>
                  <span className="an-cand-depth">глубина {c.depth ?? '—'}</span>
                </div>
              ))}
            </div>
          )}

          <div className="an-panel">
            <div className="history-header">
              <h3>Ходы / варианты</h3>
              <button className="tc-btn" onClick={runReview} disabled={analyzing}>
                {analyzing ? 'Ревью…' : 'Ревью'}
              </button>
            </div>
            {history.length === 0 ? (
              <p className="link-text">Ходов ещё нет — двигай фигуры на доске.</p>
            ) : (
              <div className="history-list">
                {pairs.map((pair) => (
                  <div key={pair.num} className="history-row">
                    <span className="move-num">{pair.num}.</span>
                    <span
                      className={node === nodeAtPly(pair.whitePly) ? 'move-white move-active' : 'move-white'}
                      onClick={() => goToPly(pair.whitePly)}
                    >
                      {pair.white.san} {reviewAnnotations[pair.whitePly] ? MOVE_ICONS[reviewAnnotations[pair.whitePly]] : ''}
                    </span>
                    {pair.black && (
                      <span
                        className={node === nodeAtPly(pair.blackPly) ? 'move-black move-active' : 'move-black'}
                        onClick={() => goToPly(pair.blackPly)}
                      >
                        {pair.black.san} {reviewAnnotations[pair.blackPly] ? MOVE_ICONS[reviewAnnotations[pair.blackPly]] : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {branches.length > 0 && (
              <div className="an-branches">
                <h4>Варианты из этой позиции</h4>
                {branches.map((b) => (
                  <button
                    key={b.move.from + b.move.to + (b.move.promotion || '')}
                    className="tc-btn"
                    onClick={() => goToNode(b)}
                  >
                    {b.move.san} {b === node.mainChild ? '(главная)' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="an-error">{error}</p>}
        </div>
      </div>

      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        mode={mode}
        setMode={setMode}
        strength={strength}
        setStrength={setStrength}
        depth={depth}
        setDepth={setDepth}
        multiPv={multiPv}
        setMultiPv={setMultiPv}
        quickMode={quickMode}
        setQuickMode={setQuickMode}
        style={style}
        setStyle={setStyle}
        error={error}
        pgnInput={pgnInput}
        setPgnInput={setPgnInput}
        onLoadPgn={loadPgn}
        onLoadPgnFile={loadPgnFile}
        fenInput={fenInput}
        setFenInput={setFenInput}
        onLoadFen={loadFen}
        onFlip={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
        onStart={goToStart}
        onEnd={goToEnd}
        onMainLine={goToMainLine}
        onClear={handleClear}
        analyzing={analyzing}
        onStop={() => engineRef.current && engineRef.current.stop()}
      />
    </div>
  )

  // Возвращает узел на заданном полуходе текущего пути (для подсветки активного хода).
  function nodeAtPly(ply) {
    const moves = treeRef.current.getHistory()
    let cur = treeRef.current.root
    const limit = Math.max(0, Math.min(ply, moves.length))
    for (let k = 0; k < limit; k++) {
      const m = moves[k]
      const child = cur.children.find(
        (c) =>
          c.move.from === m.from &&
          c.move.to === m.to &&
          (c.move.promotion || '') === (m.promotion || '')
      )
      if (child) cur = child
      else break
    }
    return cur
  }
}
