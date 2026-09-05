import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { db } from './firebaseConfig'
import { ref, onValue, set, get, remove } from 'firebase/database'

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
  const [view, setView] = useState('home') // home | create | join | game
  const [game, setGame] = useState(new Chess())
  const [roomId, setRoomId] = useState(null)
  const [color, setColor] = useState(null)
  const [status, setStatus] = useState('')
  const [moveFrom, setMoveFrom] = useState('')
  const [optionSquares, setOptionSquares] = useState({})
  const [joinInput, setJoinInput] = useState('')
  const [publicRooms, setPublicRooms] = useState([])
  const [selectedTC, setSelectedTC] = useState(TIME_CONTROLS[3]) // 5 мин по умолчанию
  const [isPublic, setIsPublic] = useState(true)
  const [roomData, setRoomData] = useState(null)
  const [tick, setTick] = useState(Date.now())

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
        if (data.fen) {
          const newGame = new Chess()
          newGame.load(data.fen)
          setGame(newGame)
          if (newGame.isGameOver()) {
            setStatus('Игра окончена')
          }
        }
      }
    })
    return () => unsubscribe()
  }, [roomId])

  // Тикающие часы (локальное отображение, раз в секунду)
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
    const initialFen = new Chess().fen()
    const clock = selectedTC.initial
      ? { whiteTime: selectedTC.initial, blackTime: selectedTC.initial, turn: 'w', turnStart: Date.now() }
      : null

    await set(ref(db, 'rooms/' + id), {
      fen: initialFen,
      isPublic,
      timeControl: { initial: selectedTC.initial, increment: selectedTC.increment, label: selectedTC.label },
      clock,
    })

    if (isPublic) {
      await set(ref(db, 'publicRooms/' + id), {
        createdAt: Date.now(),
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
      // Убираем комнату из публичного списка — место занято
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

  function tryMove(from, to) {
    if (game.turn() !== color) return false
    const gameCopy = new Chess(game.fen())
    let move
    try {
      move = gameCopy.move({ from, to, promotion: 'q' })
    } catch (e) {
      return false
    }
    if (move === null) return false

    setGame(gameCopy)

    const update = { fen: gameCopy.fen() }

    if (roomData && roomData.clock && roomData.timeControl && roomData.timeControl.initial) {
      const clock = roomData.clock
      const elapsed = (Date.now() - clock.turnStart) / 1000
      const movingSide = clock.turn // 'w' или 'b' — тот, кто только что сходил
      const newClock = { ...clock }
      const remaining = Math.max(0, (movingSide === 'w' ? clock.whiteTime : clock.blackTime) - elapsed + roomData.timeControl.increment)

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

  // Вычисляем отображаемое время на часах
  let displayWhite = null
  let displayBlack = null
  if (roomData && roomData.clock) {
    const clock = roomData.clock
    const elapsed = (tick - clock.turnStart) / 1000
    displayWhite = clock.turn === 'w' ? clock.whiteTime - elapsed : clock.whiteTime
    displayBlack = clock.turn === 'b' ? clock.blackTime - elapsed : clock.blackTime
  }

  // ---------- ЭКРАН: ГЛАВНОЕ МЕНЮ ----------
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

  // ---------- ЭКРАН: СОЗДАНИЕ КОМНАТЫ ----------
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
            <button
              className={isPublic ? 'tc-btn active' : 'tc-btn'}
              onClick={() => setIsPublic(true)}
            >
              Публичная
            </button>
            <button
              className={!isPublic ? 'tc-btn active' : 'tc-btn'}
              onClick={() => setIsPublic(false)}
            >
              Приватная
            </button>
          </div>

          <button onClick={createRoom}>Создать</button>
          <button className="secondary" onClick={() => setView('home')}>Назад</button>
        </div>
      </div>
    )
  }

  // ---------- ЭКРАН: ВХОД В КОМНАТУ ----------
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

  // ---------- ЭКРАН: ИГРА ----------
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
          <h3>История ходов</h3>
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
