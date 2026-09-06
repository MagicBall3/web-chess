import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { db } from './firebaseConfig'
import { ref, onValue, set, get, remove } from 'firebase/database'
import { evaluatePosition } from './stockfish'

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
  const [evalScore, setEvalScore] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const existingRoom = params.get('room')
    if (existingRoom) {
      joinRoom(existingRoom)
    }
  }, [])

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
          } catch (e) {
            // если PGN битый, откатываемся на стартовую позицию
          }
        }
        setGame(newGame)
        if (newGame.isGameOver()) {
          setStatus('Игра окончена')
        }
      }
    })
    return () => unsubscribe()
  }, [roomId])

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

  // Восстанавливаем полную партию из PGN, потом применяем новый ход —
  // так локальная копия не теряет историю
  function tryMove(from, to) {
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
      const elapsed = (Date.now() - clock.turnStart) / 1000
      const movingSide = clock.turn
      const newClock = { ...clock }
      const remaining = Math.max(
        0,
        (movingSide === 'w' ? clock.whiteTime : clock.blackTime) - elapsed + roomData.timeControl.increment
      )
      if (movingSide === 'w') newClock.whiteTime = remaining
      else newClock.blackTime = remaining
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
    const elapsed = (tick - clock.turnStart) / 1000
    displayWhite = clock.turn === 'w' ? clock.whiteTime - elapsed : clock.whiteTime
    displayBlack = clock.turn === 'b' ? clock.blackTime - elapsed : clock.blackTime
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

  async function testEngine() {
    setStatus('Считаю...')
    const result = await evaluatePosition(game.fen(), 12)
    if (result.score) {
      // UCI отдаёт оценку с точки зрения того, чей сейчас ход — приводим к оценке "за белых"
      const sideToMove = game.turn()
      const normalized = sideToMove === 'w' ? result.score : { ...result.score, value: -result.score.value }
      setEvalScore(normalized)

      const scoreText = normalized.type === 'mate'
        ? `Мат в ${Math.abs(normalized.value)}`
        : `${(normalized.value / 100).toFixed(2)}`

      // Переводим лучший ход из формата "e7e5" в обычную шахматную запись (например "e5")
      let sanMove = result.bestMove
      try {
        const tempGame = new Chess(game.fen())
        const from = result.bestMove.slice(0, 2)
        const to = result.bestMove.slice(2, 4)
        const promotion = result.bestMove.length > 4 ? result.bestMove.slice(4) : undefined
        const moveResult = tempGame.move({ from, to, promotion })
        if (moveResult) sanMove = moveResult.san
      } catch (e) {}

      setStatus(`Оценка: ${scoreText}, лучший ход: ${sanMove}`)
    } else {
      setStatus('Не удалось получить оценку')
    }
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
          <button onClick={() => setView('create')}>Создать комнату</button>
          <button className="secondary" onClick={() => setView('join')}>Войти в комнату</button>
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

        <div className="history-panel">
          <div className="history-header">
            <h3>История ходов</h3>
            <button className="copy-btn" onClick={copyPgn}>Копировать PGN</button>
            <button className="copy-btn" onClick={testEngine}>Проверить движок</button>
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
      </div>
    </div>
  )
}
