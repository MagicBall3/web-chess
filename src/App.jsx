import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { db } from './firebaseConfig'
import { ref, onValue, set, get, remove } from 'firebase/database'
import { evaluatePosition } from './stockfish'
import { classifyMove, isPieceHanging, MOVE_ICONS } from './moveClassifier'
import { subscribeToAuth, loginUser, registerUser, logoutUser } from './auth'

const TIME_CONTROLS = [
  { key: 'unlimited', label: 'Без ограничения', initial: null, increment: 0 },
  { key: '1+0', label: '1 мин', initial: 60, increment: 0 },
  { key: '3+0', label: '3 мин', initial: 180, increment: 0 },
  { key: '5+0', label: '5 мин', initial: 300, increment: 0 },
  { key: '10+0', label: '10 мин', initial: 600, increment: 0 },
  { key: '15+10', label: '15 | 10', initial: 900, increment: 10 },
]

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8)
}

function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return '--:--'
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function evalToWhitePercent(score) {
  if (!score) return 50
  if (score.type === 'mate') {
    return score.value > 0 ? 100 : 0
  }
  const cp = score.value
  const percent = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1)
  return Math.max(3, Math.min(97, percent))
}

function iconBackgroundStyle(icon) {
  if (!icon) return {}
  const emoji = MOVE_ICONS[icon]
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><text x='37' y='15' font-size='16' text-anchor='end'>${emoji}</text></svg>`
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  return {
    backgroundImage: `url("${url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'contain',
  }
}

export default function App() {
  const [view, setView] = useState('home')
  const [game, setGame] = useState(new Chess())
  const [roomId, setRoomId] = useState(null)
  const [color, setColor] = useState(null)
  const [status, setStatus] = useState('')
  const [moveFrom, setMoveFrom] = useState('')
  const [optionSquares, setOptionSquares] = useState({})
  const [joinInput, setJoinInput] = useState('')
  const [publicRooms, setPublicRooms] = useState([])
  const [selectedTC, setSelectedTC] = useState(TIME_CONTROLS[3])
  const [isPublic, setIsPublic] = useState(true)
  const [roomData, setRoomData] = useState(null)
  const [tick, setTick] = useState(Date.now())
  const [analysisPly, setAnalysisPly] = useState(0)
  const [analysisEval, setAnalysisEval] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisTick, setAnalysisTick] = useState(0)
  const [analysisBestMove, setAnalysisBestMove] = useState(null)
  const [showBestMoveArrow, setShowBestMoveArrow] = useState(true)
  const [currentUser, setCurrentUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [myGames, setMyGames] = useState([])

  const analysisRef = useRef({ evalHistory: [], annotations: [], running: false, roomId: null })
  const savedGameRef = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const existingRoom = params.get('room')
    if (existingRoom) {
      joinRoom(existingRoom)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeToAuth((user) => {
      setCurrentUser(user)
      setAuthChecked(true)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!currentUser) {
      setIsAdmin(false)
      return
    }
    get(ref(db, 'admins/' + currentUser.uid)).then((snapshot) => {
      setIsAdmin(snapshot.exists())
    })
  }, [currentUser])

  async function handleAuthSubmit() {
    setAuthError('')
    try {
      if (authMode === 'login') {
        await loginUser(authEmail, authPassword)
      } else {
        await registerUser(authEmail, authPassword)
      }
      setView('home')
      setAuthEmail('')
      setAuthPassword('')
    } catch (e) {
      setAuthError(e.message)
    }
  }

  async function handleLogout() {
    await logoutUser()
  }

  useEffect(() => {
    if (!roomId) return
    const roomRef = ref(db, 'rooms/' + roomId)
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        setRoomData(data)
        const newGame = new Chess()
        if (data.pgn) {
          try {
            newGame.loadPgn(data.pgn)
          } catch (e) {}
        }
        setGame(newGame)

        if (newGame.isGameOver() && !savedGameRef.current) {
          savedGameRef.current = true

          if (currentUser) {
            const gameKey = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
            const resultTag = newGame.isCheckmate()
              ? (newGame.turn() === 'w' ? '0-1' : '1-0')
              : (newGame.isDraw() ? '1/2-1/2' : '*')

            set(ref(db, `users/${currentUser.uid}/games/${gameKey}`), {
              pgn: data.pgn || '',
              result: resultTag,
              color,
              timeControlLabel: data.timeControl?.label || '',
              finishedAt: Date.now(),
            })
          }

          remove(ref(db, 'rooms/' + roomId))
          remove(ref(db, 'publicRooms/' + roomId))
        }
      }
    })
    return () => unsubscribe()
  }, [roomId, currentUser])

  useEffect(() => {
    if (!roomData || !roomData.clock) return
    const interval = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [roomData])

  useEffect(() => {
    if (view === 'join') {
      const publicRef = ref(db, 'publicRooms')
      const unsubscribe = onValue(publicRef, (snapshot) => {
        const data = snapshot.val() || {}
        const list = Object.entries(data).map(([id, val]) => ({ id, ...val }))
        list.sort((a, b) => b.createdAt - a.createdAt)
        setPublicRooms(list)
      })
      return () => unsubscribe()
    }
  }, [view])

  useEffect(() => {
    if (view === 'myGames' && currentUser) {
      get(ref(db, `users/${currentUser.uid}/games`)).then((snapshot) => {
        const data = snapshot.val() || {}
        const list = Object.entries(data).map(([id, val]) => ({ id, ...val }))
        list.sort((a, b) => b.finishedAt - a.finishedAt)
        setMyGames(list)
      })
    }
  }, [view, currentUser])

  function openSavedGame(gameRecord) {
    const newGame = new Chess()
    try {
      newGame.loadPgn(gameRecord.pgn)
    } catch (e) {}
    setGame(newGame)
    setRoomData({
      createdAt: gameRecord.finishedAt,
      timeControl: { label: gameRecord.timeControlLabel },
    })
    setColor(gameRecord.color || 'w')
    setRoomId(null)
    analysisRef.current = { evalHistory: [], annotations: [], running: false, roomId: null }
    setAnalysisPly(newGame.history().length)
    setView('analysis')
  }

  function formatGameDate(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  useEffect(() => {
    analysisRef.current = { evalHistory: [], annotations: [], running: false, roomId }
    savedGameRef.current = false
  }, [roomId])

  const verboseHistory = useMemo(() => game.history({ verbose: true }), [game])

  function fenAtPly(ply) {
    const g = new Chess()
    for (let i = 0; i < ply; i++) {
      const m = verboseHistory[i]
      g.move({ from: m.from, to: m.to, promotion: m.promotion })
    }
    return g.fen()
  }

  function goToPly(p) {
    const clamped = Math.max(0, Math.min(verboseHistory.length, p))
    setAnalysisPly(clamped)
  }

  useEffect(() => {
    if (view !== 'analysis') return
    let cancelled = false
    async function run() {
      const fen = fenAtPly(analysisPly)
      const result = await evaluatePosition(fen, 12)
      if (cancelled) return
      const g = new Chess(fen)
      const sideToMove = g.turn()
      const normalized = result.score
        ? (sideToMove === 'w' ? result.score : { ...result.score, value: -result.score.value })
        : null
      setAnalysisEval(normalized)
      setAnalysisBestMove(result.bestMove || null)
    }
    run()
    return () => { cancelled = true }
  }, [analysisPly, view])

  async function runFullAnalysis() {
    if (analyzing) return
    setAnalyzing(true)
    const state = analysisRef.current
    state.evalHistory = []
    state.annotations = []

    const totalPlies = verboseHistory.length

    const startResult = await evaluatePosition(new Chess().fen(), 14)
    state.evalHistory.push(startResult)
    setAnalysisProgress(1)

    for (let ply = 1; ply <= totalPlies; ply++) {
      const fen = fenAtPly(ply)
      const result = await evaluatePosition(fen, 14)
      state.evalHistory.push(result)

      const moveIndex = ply - 1
      const move = verboseHistory[moveIndex]
      const prevEntry = state.evalHistory[moveIndex]
      const currEntry = state.evalHistory[ply]
      const uciMove = move.from + move.to + (move.promotion || '')
      const afterGame = new Chess(fen)
      const hanging = isPieceHanging(afterGame, move.to)

      const classification = classifyMove({ prevEntry, currEntry, uciMove, piece: move.piece, hanging })
      state.annotations[moveIndex] = classification
      setAnalysisProgress(ply + 1)
      setAnalysisTick((t) => t + 1)
    }

    setAnalyzing(false)
  }

  async function createRoom() {
    const id = generateRoomId()
    const createdAt = Date.now()
    const clock = selectedTC.initial
      ? { whiteTime: selectedTC.initial, blackTime: selectedTC.initial, turn: 'w', turnStart: createdAt }
      : null

    await set(ref(db, 'rooms/' + id), {
      fen: new Chess().fen(),
      pgn: '',
      isPublic,
      createdAt,
      timeControl: { initial: selectedTC.initial, increment: selectedTC.increment, label: selectedTC.label },
      clock,
    })

    if (isPublic) {
      await set(ref(db, 'publicRooms/' + id), {
        createdAt,
        timeControlLabel: selectedTC.label,
      })
    }

    setRoomId(id)
    setColor('w')
    setView('game')
    window.history.replaceState(null, '', '?room=' + id)
  }

  async function joinRoom(id) {
    const snapshot = await get(ref(db, 'rooms/' + id))
    if (snapshot.exists()) {
      setRoomId(id)
      setColor('b')
      setView('game')
      window.history.replaceState(null, '', '?room=' + id)
      remove(ref(db, 'publicRooms/' + id))
    } else {
      setStatus('Комната не найдена')
    }
  }

  function handleJoinSubmit() {
    const trimmed = joinInput.trim()
    if (trimmed) joinRoom(trimmed)
  }

  function handleExit() {
    setRoomId(null)
    setRoomData(null)
    setView('home')
    window.history.replaceState(null, '', window.location.pathname)
  }

  function handleNewGame() {
    setRoomId(null)
    setRoomData(null)
    setView('create')
    window.history.replaceState(null, '', window.location.pathname)
  }

  function handleAnalyze() {
    setAnalysisPly(verboseHistory.length)
    setView('analysis')
  }

  function getMoveOptions(square) {
    const moves = game.moves({ square, verbose: true })
    if (moves.length === 0) {
      setOptionSquares({})
      return false
    }
    const newSquares = {}
    moves.forEach((move) => {
      newSquares[move.to] = {
        background:
          game.get(move.to) && game.get(move.to).color !== game.get(square).color
            ? 'radial-gradient(circle, rgba(255,0,0,0.4) 85%, transparent 85%)'
            : 'radial-gradient(circle, rgba(0,0,0,0.3) 25%, transparent 25%)',
        borderRadius: '50%',
      }
    })
    newSquares[square] = { background: 'rgba(255, 255, 0, 0.4)' }
    setOptionSquares(newSquares)
    return true
  }

  function onSquareClick(square) {
    if (game.isGameOver()) return
    if (!moveFrom) {
      const piece = game.get(square)
      if (piece && piece.color === color) {
        setMoveFrom(square)
        getMoveOptions(square)
      }
      return
    }
    const moved = tryMove(moveFrom, square)
    setMoveFrom('')
    setOptionSquares({})
    if (!moved) {
      const piece = game.get(square)
      if (piece && piece.color === color) {
        setMoveFrom(square)
        getMoveOptions(square)
      }
    }
  }

  function tryMove(from, to) {
    if (game.isGameOver()) return false
    if (game.turn() !== color) return false

    const gameCopy = new Chess()
    if (roomData && roomData.pgn) {
      try {
        gameCopy.loadPgn(roomData.pgn)
      } catch (e) {}
    }

    let move
    try {
      move = gameCopy.move({ from, to, promotion: 'q' })
    } catch (e) {
      return false
    }
    if (move === null) return false

    setGame(gameCopy)

    const update = { fen: gameCopy.fen(), pgn: gameCopy.pgn() }

    if (roomData && roomData.clock && roomData.timeControl && roomData.timeControl.initial) {
      const clock = roomData.clock
      const movingSide = clock.turn
      const newClock = { ...clock }
      const isFreeMove = verboseHistory.length < 2

      if (isFreeMove) {
        // Время не тратим
      } else {
        const elapsed = (Date.now() - clock.turnStart) / 1000
        const remaining = Math.max(
          0,
          (movingSide === 'w' ? clock.whiteTime : clock.blackTime) - elapsed + roomData.timeControl.increment
        )
        if (movingSide === 'w') newClock.whiteTime = remaining
        else newClock.blackTime = remaining
      }

      newClock.turn = movingSide === 'w' ? 'b' : 'w'
      newClock.turnStart = Date.now()
      update.clock = newClock
    }

    set(ref(db, 'rooms/' + roomId), { ...roomData, ...update })
    return true
  }

  const onDrop = useCallback((sourceSquare, targetSquare) => {
    const result = tryMove(sourceSquare, targetSquare)
    setMoveFrom('')
    setOptionSquares({})
    return result
  }, [game, color, roomId, roomData])

  function onDragBegin(piece, sourceSquare) {
    if (game.isGameOver()) return
    getMoveOptions(sourceSquare)
  }

  const checkSquareStyle = useMemo(() => {
    if (!game.inCheck()) return {}
    const kingColor = game.turn()
    const board = game.board()
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c]
        if (piece && piece.type === 'k' && piece.color === kingColor) {
          const file = 'abcdefgh'[c]
          const rank = 8 - r
          return { [`${file}${rank}`]: { background: 'rgba(255, 0, 0, 0.6)' } }
        }
      }
    }
    return {}
  }, [game])

  const customSquareStyles = { ...optionSquares, ...checkSquareStyle }

  const moveHistory = useMemo(() => {
    const hist = game.history()
    const pairs = []
    for (let i = 0; i < hist.length; i += 2) {
      pairs.push({ num: i / 2 + 1, white: hist[i], black: hist[i + 1] || '' })
    }
    return pairs
  }, [game])

  const turnText = game.turn() === color ? 'Твой ход' : 'Ход соперника'

  let displayWhite = null
  let displayBlack = null
  if (roomData && roomData.clock) {
    const clock = roomData.clock
    const clockRunning = verboseHistory.length >= 2
    if (clockRunning) {
      const elapsed = (tick - clock.turnStart) / 1000
      displayWhite = clock.turn === 'w' ? clock.whiteTime - elapsed : clock.whiteTime
      displayBlack = clock.turn === 'b' ? clock.blackTime - elapsed : clock.blackTime
    } else {
      displayWhite = clock.whiteTime
      displayBlack = clock.blackTime
    }
  }

  function getResultTag() {
    if (game.isCheckmate()) return game.turn() === 'w' ? '0-1' : '1-0'
    if (game.isDraw()) return '1/2-1/2'
    return '*'
  }

  function getTerminationTag() {
    if (game.isCheckmate()) return 'Мат'
    if (game.isStalemate()) return 'Пат'
    if (game.isDraw()) return 'Ничья'
    return 'Партия не окончена'
  }

  function getGameOverMessage() {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Чёрные' : 'Белые'
      return `Мат! Победили: ${winner}`
    }
    if (game.isStalemate()) return 'Пат — ничья'
    if (game.isDraw()) return 'Ничья'
    return 'Игра окончена'
  }

  function copyPgn() {
    const dateStr = new Date(roomData?.createdAt || Date.now())
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '.')
    const headers = [
      `[Event "Web Chess"]`,
      `[Site "web-chess"]`,
      `[Date "${dateStr}"]`,
      `[Round "1"]`,
      `[White "Белые"]`,
      `[Black "Чёрные"]`,
      `[Result "${getResultTag()}"]`,
      roomData?.timeControl?.label ? `[TimeControl "${roomData.timeControl.label}"]` : null,
      `[Termination "${getTerminationTag()}"]`,
    ].filter(Boolean).join('\n')

    const movesText = moveHistory
      .map((pair) => `${pair.num}. ${pair.white}${pair.black ? ' ' + pair.black : ''}`)
      .join(' ')

    const full = headers + '\n\n' + movesText + (movesText ? ` ${getResultTag()}` : '')

    navigator.clipboard.writeText(full).then(() => {
      setStatus('PGN скопирован в буфер обмена')
    }).catch(() => {
      setStatus('Не удалось скопировать PGN')
    })
  }

  if (view === 'home') {
    return (
      <div className="app-container">
        <div className="card">
          <h1>Web Chess</h1>

          {currentUser ? (
            <p className="link-text">Вошёл как: {currentUser.email}</p>
          ) : (
            <p className="link-text">Гость (не вошёл в аккаунт)</p>
          )}

          <button onClick={() => setView('create')}>Создать комнату</button>
          <button className="secondary" onClick={() => setView('join')}>Войти в комнату</button>

          {currentUser && (
            <button className="secondary" onClick={() => setView('myGames')}>Мои партии</button>
          )}

          {currentUser ? (
            <button className="secondary" onClick={handleLogout}>Выйти из аккаунта</button>
          ) : (
            <button className="secondary" onClick={() => setView('auth')}>Войти / Регистрация</button>
          )}

          <p>{status}</p>
        </div>
      </div>
    )
  }

  if (view === 'create') {
    return (
      <div className="app-container">
        <div className="card">
          <h1>Новая игра</h1>
          <h3>Контроль времени</h3>
          <div className="tc-grid">
            {TIME_CONTROLS.map((tc) => (
              <button
                key={tc.key}
                className={tc.key === selectedTC.key ? 'tc-btn active' : 'tc-btn'}
                onClick={() => setSelectedTC(tc)}
              >
                {tc.label}
              </button>
            ))}
          </div>
          <h3>Тип комнаты</h3>
          <div className="tc-grid">
            <button className={isPublic ? 'tc-btn active' : 'tc-btn'} onClick={() => setIsPublic(true)}>
              Публичная
            </button>
            <button className={!isPublic ? 'tc-btn active' : 'tc-btn'} onClick={() => setIsPublic(false)}>
              Приватная
            </button>
          </div>
          <button onClick={createRoom}>Создать</button>
          <button className="secondary" onClick={() => setView('home')}>Назад</button>
        </div>
      </div>
    )
  }

  if (view === 'auth') {
    return (
      <div className="app-container">
        <div className="card">
          <h1>{authMode === 'login' ? 'Вход' : 'Регистрация'}</h1>

          <div className="tc-grid">
            <button
              className={authMode === 'login' ? 'tc-btn active' : 'tc-btn'}
              onClick={() => setAuthMode('login')}
            >
              Вход
            </button>
            <button
              className={authMode === 'register' ? 'tc-btn active' : 'tc-btn'}
              onClick={() => setAuthMode('register')}
            >
              Регистрация
            </button>
          </div>

          <div className="join-block" style={{ flexDirection: 'column' }}>
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Пароль"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
            />
          </div>

          <button onClick={handleAuthSubmit}>
            {authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
          <button className="secondary" onClick={() => setView('home')}>Назад</button>

          {authError && <p className="link-text">{authError}</p>}
        </div>
      </div>
    )
  }

  if (view === 'join') {
    return (
      <div className="app-container">
        <div className="card">
          <h1>Войти в комнату</h1>
          <h3>Приватная комната</h3>
          <div className="join-block">
            <input
              type="text"
              placeholder="ID комнаты"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
            />
            <button onClick={handleJoinSubmit}>Подключиться</button>
          </div>
          <h3>Публичные комнаты</h3>
          {publicRooms.length === 0 ? (
            <p className="link-text">Сейчас нет открытых публичных комнат</p>
          ) : (
            <div className="public-list">
              {publicRooms.map((r) => (
                <div key={r.id} className="public-row" onClick={() => joinRoom(r.id)}>
                  <span>{r.id}</span>
                  <span className="link-text">{r.timeControlLabel}</span>
                </div>
              ))}
            </div>
          )}
          <button className="secondary" onClick={() => setView('home')}>Назад</button>
          <p>{status}</p>
        </div>
      </div>
    )
  }

  if (view === 'analysis') {
    const displayFen = fenAtPly(analysisPly)
    const lastMove = analysisPly > 0 ? verboseHistory[analysisPly - 1] : null
    const lastMoveIcon = lastMove ? analysisRef.current.annotations[analysisPly - 1] : null
    const analysisSquareStyles = lastMove && lastMoveIcon
      ? { [lastMove.to]: iconBackgroundStyle(lastMoveIcon) }
      : {}
    const bestMoveArrow = showBestMoveArrow && analysisBestMove
      ? [[analysisBestMove.slice(0, 2), analysisBestMove.slice(2, 4), '#1ea64c']]
      : []

    const pairs = []
    for (let i = 0; i < verboseHistory.length; i += 2) {
      const wIcon = analysisRef.current.annotations[i]
      const bIcon = verboseHistory[i + 1] ? analysisRef.current.annotations[i + 1] : null
      pairs.push({
        num: i / 2 + 1,
        white: verboseHistory[i]?.san,
        whiteIcon: wIcon ? MOVE_ICONS[wIcon] : '',
        whitePly: i + 1,
        black: verboseHistory[i + 1]?.san || '',
        blackIcon: bIcon ? MOVE_ICONS[bIcon] : '',
        blackPly: i + 2,
      })
    }

    return (
      <div className="app-container">
        <div className="card board-card">
          <h2>Анализ партии</h2>

          <div className="board-wrapper">
            <div className="eval-bar">
              <div className="eval-bar-black" style={{ height: `${100 - evalToWhitePercent(analysisEval)}%` }} />
              <div className="eval-bar-white" style={{ height: `${evalToWhitePercent(analysisEval)}%` }} />
            </div>
            <div className="board-inner">
              <Chessboard
                position={displayFen}
                boardOrientation={color === 'w' ? 'white' : 'black'}
                arePiecesDraggable={false}
                customSquareStyles={analysisSquareStyles}
                customArrows={bestMoveArrow}
                customDarkSquareStyle={{ backgroundColor: '#4a4a68' }}
                customLightSquareStyle={{ backgroundColor: '#e8e8f0' }}
              />
            </div>
          </div>

          <div className="nav-controls">
            <button className="tc-btn" onClick={() => goToPly(0)}>|◀</button>
            <button className="tc-btn" onClick={() => goToPly(analysisPly - 1)}>◀</button>
            <button className="tc-btn" onClick={() => goToPly(analysisPly + 1)}>▶</button>
            <button className="tc-btn" onClick={() => goToPly(verboseHistory.length)}>▶|</button>
          </div>

          <div className="nav-controls">
            <button
              className={showBestMoveArrow ? 'tc-btn active' : 'tc-btn'}
              onClick={() => setShowBestMoveArrow((v) => !v)}
            >
              Стрелка лучшего хода: {showBestMoveArrow ? 'вкл' : 'выкл'}
            </button>
          </div>

          <button onClick={runFullAnalysis} disabled={analyzing}>
            {analyzing ? `Анализирую... ${analysisProgress}/${verboseHistory.length + 1}` : 'Показать оценки ходов'}
          </button>

          <div className="history-panel">
            <h3>История ходов</h3>
            <div className="history-list">
              {pairs.map((pair) => (
                <div key={pair.num} className="history-row">
                  <span className="move-num">{pair.num}.</span>
                  <span
                    className={analysisPly === pair.whitePly ? 'move-white move-active' : 'move-white'}
                    onClick={() => goToPly(pair.whitePly)}
                  >
                    {pair.white} {pair.whiteIcon}
                  </span>
                  {pair.black && (
                    <span
                      className={analysisPly === pair.blackPly ? 'move-black move-active' : 'move-black'}
                      onClick={() => goToPly(pair.blackPly)}
                    >
                      {pair.black} {pair.blackIcon}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button className="secondary" onClick={handleExit}>Выйти в меню</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="card board-card">
        <h2>Комната: {roomId}</h2>
        <p>Ты играешь за: {color === 'w' ? 'белых' : 'чёрных'} — {turnText}</p>
        <p className="link-text">Ссылка для друга: {window.location.href}</p>

        {roomData && roomData.clock && (
          <div className="clocks">
            <div className={game.turn() === 'b' ? 'clock active' : 'clock'}>
              Чёрные: {formatTime(displayBlack)}
            </div>
            <div className={game.turn() === 'w' ? 'clock active' : 'clock'}>
              Белые: {formatTime(displayWhite)}
            </div>
          </div>
        )}

        <div className="board-wrapper">
          <div className="board-inner">
            <Chessboard
              position={game.fen()}
              onPieceDrop={onDrop}
              onSquareClick={onSquareClick}
              onPieceDragBegin={onDragBegin}
              boardOrientation={color === 'w' ? 'white' : 'black'}
              customSquareStyles={customSquareStyles}
              customDarkSquareStyle={{ backgroundColor: '#4a4a68' }}
              customLightSquareStyle={{ backgroundColor: '#e8e8f0' }}
            />
          </div>
        </div>

        <div className="history-panel">
          <div className="history-header">
            <h3>История ходов</h3>
            <button className="copy-btn" onClick={copyPgn}>Копировать PGN</button>
          </div>
          {moveHistory.length === 0 ? (
            <p className="link-text">Ходов ещё не было</p>
          ) : (
            <div className="history-list">
              {moveHistory.map((pair) => (
                <div key={pair.num} className="history-row">
                  <span className="move-num">{pair.num}.</span>
                  <span className="move-white">{pair.white}</span>
                  <span className="move-black">{pair.black}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p>{status}</p>

        {game.isGameOver() && (
          <div className="modal-overlay">
            <div className="modal-card">
              <h2>{getGameOverMessage()}</h2>
              <button onClick={handleNewGame}>Новая игра</button>
              <button className="secondary" onClick={handleExit}>Выйти</button>
              <button className="secondary" onClick={handleAnalyze}>Анализ партии</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
