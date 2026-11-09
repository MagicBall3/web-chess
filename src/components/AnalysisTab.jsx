import React, { useEffect, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import { GameTree } from '../gameTree.js'
import { AnalysisEngine } from '../analysisEngine.js'
import { rankCandidates } from '../moveSelector.js'
import { classifyMove, MOVE_ICONS, MOVE_LABELS } from '../moveClassifier.js'

const ANALYSIS_MODES = [
  { key: 'live', label: 'Live-оценка' },
  { key: 'candidates', label: 'Кандидаты' },
  { key: 'human', label: 'Рекомендации' },
  { key: 'review', label: 'Ревью партии' },
]

const DEFAULT_DEPTH = 14
const MIN_ELO = 600
const MAX_ELO = 2800

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

export default function AnalysisTab({ initialPgn = null, onExit = null }) {
  const treeRef = useRef(new GameTree())
  const engineRef = useRef(null)

  const [node, setNode] = useState(treeRef.current.root)
  const [mode, setMode] = useState('live')
  const [multiPv, setMultiPv] = useState(3)
  const [depth, setDepth] = useState(DEFAULT_DEPTH)
  const [elo, setElo] = useState(null)
  const [style, setStyle] = useState('balanced')
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [showPgnImport, setShowPgnImport] = useState(false)
  const [pgnInput, setPgnInput] = useState('')
  const [showFenInput, setShowFenInput] = useState(false)
  const [fenInput, setFenInput] = useState('')
  const [reviewAnnotations, setReviewAnnotations] = useState({})
  const [showArrow, setShowArrow] = useState(true)

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

  // Автоанализ текущей позиции (кроме режима ревью).
  useEffect(() => {
    if (mode === 'review') return
    let cancelled = false
    const eng = getEngine()
    setAnalyzing(true)
    ;(async () => {
      try {
        if (mode === 'live') {
          const res = await eng.analyze({ fen, depth, multiPv: 1, elo })
          if (!cancelled) {
            setAnalysis({
              eval: res[0] ? res[0].score : null,
              bestMove: res[0] ? res[0].bestMove : null,
              candidates: res,
            })
          }
        } else {
          const res = await eng.analyze({ fen, depth, multiPv, elo })
          if (cancelled) return
          if (mode === 'human') {
            const ranked = rankCandidates(res, { fen, sideToMove, style })
            setAnalysis({ candidates: res, ranked })
          } else {
            setAnalysis({ candidates: res })
          }
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
  }, [fen, mode, depth, multiPv, elo, style])

  // --- действия с деревом ---

  const handleDrop = (source, target) => {
    const legal = treeRef.current.legalMoves()
    const match = legal.find((m) => m.from === source && m.to === target)
    if (!match) return false
    try {
      const played = treeRef.current.playMove({
        from: source,
        to: target,
        promotion: match.promotion ? 'q' : undefined,
      })
      if (played) {
        setNode(played)
        setAnalysis(null)
        setReviewAnnotations({})
      }
      return !!played
    } catch {
      return false
    }
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

  const loadPgn = () => {
    try {
      treeRef.current.loadPgn(pgnInput)
      setNode(treeRef.current.current)
      setPgnInput('')
      setShowPgnImport(false)
      setAnalysis(null)
      setReviewAnnotations({})
      setError('')
    } catch (e) {
      setError('Не удалось загрузить PGN: ' + e.message)
    }
  }

  const loadFen = () => {
    try {
      const chess = new Chess(fenInput)
      treeRef.current.loadFen(chess.fen())
      setNode(treeRef.current.root)
      setFenInput('')
      setShowFenInput(false)
      setAnalysis(null)
      setReviewAnnotations({})
      setError('')
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
      evals.push((await eng.analyze({ fen: treeRef.current.root.fen, depth, multiPv: 1, elo }))[0])
      const annotations = {}
      for (let i = 0; i < pathNodes.length; i++) {
        const nd = pathNodes[i]
        const res = (await eng.analyze({ fen: nd.fen, depth, multiPv: 1, elo }))[0]
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

  // --- производные для отрисовки ---

  const arrows = []
  if (showArrow && analysis && analysis.bestMove) {
    const bm = analysis.bestMove
    if (bm.length >= 4) arrows.push([bm.slice(0, 2), bm.slice(2, 4)])
  }

  const highlight = {}
  if (mode === 'human' && analysis && analysis.ranked && analysis.ranked.length) {
    const top = analysis.ranked[0]
    if (top.move) {
      highlight[top.move.slice(0, 2)] = { background: 'rgba(0,200,0,0.35)' }
      highlight[top.move.slice(2, 4)] = { background: 'rgba(0,200,0,0.35)' }
    }
  } else if (mode === 'candidates' && analysis && analysis.candidates && analysis.candidates.length) {
    const top = analysis.candidates[0]
    if (top && top.bestMove) {
      highlight[top.bestMove.slice(0, 2)] = { background: 'rgba(0,150,255,0.3)' }
      highlight[top.bestMove.slice(2, 4)] = { background: 'rgba(0,150,255,0.3)' }
    }
  }

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

  return (
    <div className="app-container">
      <div className="card board-card">
        <h2>Анализ партии</h2>

        <div className="an-toolbar">
          <button className="tc-btn" onClick={() => setShowPgnImport((v) => !v)}>Импорт PGN</button>
          <button className="tc-btn" onClick={() => setShowFenInput((v) => !v)}>FEN</button>
          <button className="tc-btn" onClick={resetToStart}>Начальная позиция</button>
          <button className="tc-btn" onClick={goToMainLine}>К основной линии</button>
        </div>

        {showPgnImport && (
          <div className="an-import">
            <textarea
              rows={4}
              placeholder="Вставьте PGN партии…"
              value={pgnInput}
              onChange={(e) => setPgnInput(e.target.value)}
            />
            <div className="an-import-btns">
              <button onClick={loadPgn}>Загрузить</button>
              <button className="secondary" onClick={() => setShowPgnImport(false)}>Отмена</button>
            </div>
          </div>
        )}

        {showFenInput && (
          <div className="an-import">
            <input
              type="text"
              placeholder="Вставьте FEN позиции…"
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
            />
            <div className="an-import-btns">
              <button onClick={loadFen}>Загрузить</button>
              <button className="secondary" onClick={() => setShowFenInput(false)}>Отмена</button>
            </div>
          </div>
        )}

        <div className="an-settings">
          <div className="an-setting-row">
            <span>Сила: {elo ? `Elo ${elo}` : 'Максимум'}</span>
            <input
              type="range"
              min={MIN_ELO}
              max={MAX_ELO}
              step={100}
              disabled={!elo}
              value={elo ?? MAX_ELO}
              onChange={(e) => setElo(Number(e.target.value))}
            />
            <button className="tc-btn" onClick={() => setElo(elo ? null : 1500)}>
              {elo ? 'Снять ограничение' : 'Ограничить силу'}
            </button>
          </div>
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
        </div>

        <div className="an-modes">
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

        <div className="board-wrapper">
          <div className="eval-bar">
            <div className="eval-bar-black" style={{ height: `${100 - evalToWhitePercent(analysis ? analysis.eval : null)}%` }} />
            <div className="eval-bar-white" style={{ height: `${evalToWhitePercent(analysis ? analysis.eval : null)}%` }} />
          </div>
          <div className="board-inner">
            <Chessboard
              position={fen}
              arePiecesDraggable
              onPieceDrop={handleDrop}
              customSquareStyles={highlight}
              customArrows={arrows}
              customDarkSquareStyle={{ backgroundColor: '#4a4a68' }}
              customLightSquareStyle={{ backgroundColor: '#e8e8f0' }}
            />
          </div>
        </div>

        <div className="an-eval-text">
          {analyzing ? 'Анализирую…' : `Оценка: ${formatScore(analysis ? analysis.eval : null)}`}
        </div>

        <div className="nav-controls">
          <button className="tc-btn" onClick={goToStart}>|◀</button>
          <button className="tc-btn" onClick={goPrev}>◀</button>
          <button className="tc-btn" onClick={goNext}>▶</button>
          <button className="tc-btn" onClick={goToEnd}>▶|</button>
        </div>

        <div className="nav-controls">
          <button
            className={showArrow ? 'tc-btn active' : 'tc-btn'}
            onClick={() => setShowArrow((v) => !v)}
          >
            Стрелка лучшего хода: {showArrow ? 'вкл' : 'выкл'}
          </button>
        </div>

        {mode === 'review' && (
          <button onClick={runReview} disabled={analyzing}>
            {analyzing ? 'Идёт ревью…' : 'Запустить ревью партии'}
          </button>
        )}

        {mode === 'candidates' && analysis && analysis.candidates && (
          <div className="an-candidates">
            <h3>Кандидатные ходы</h3>
            {analysis.candidates.map((c) => (
              <div key={c.multipv} className="an-cand">
                <span className="an-cand-num">{c.multipv}.</span>
                <span className="an-cand-pv">{c.bestMove} · {c.pv.join(' ')}</span>
                <span className="an-cand-score">{formatScore(c.score)}</span>
              </div>
            ))}
          </div>
        )}

        {mode === 'human' && analysis && analysis.ranked && (
          <div className="an-candidates">
            <h3>Рекомендации ({style})</h3>
            {analysis.ranked.map((r, idx) => (
              <div key={idx} className="an-cand">
                <span className="an-cand-num">{idx + 1}.</span>
                <span className="an-cand-pv">{r.san || r.move}</span>
                <span className="an-cand-score">Потеря: {r.loss}</span>
              </div>
            ))}
          </div>
        )}

        {error && <p className="an-error">{error}</p>}

        <div className="history-panel">
          <div className="history-header">
            <h3>История / варианты</h3>
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

        {onExit && <button className="secondary" onClick={onExit}>Выйти в меню</button>}
      </div>
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
