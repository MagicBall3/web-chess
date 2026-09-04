import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { db } from './firebaseConfig'
import { ref, onValue, set, get } from 'firebase/database'

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8)
}

export default function App() {
  const [game, setGame] = useState(new Chess())
  const [roomId, setRoomId] = useState(null)
  const [color, setColor] = useState(null)
  const [status, setStatus] = useState('')
  const [moveFrom, setMoveFrom] = useState('')
  const [optionSquares, setOptionSquares] = useState({})

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
      if (data && data.fen) {
        const newGame = new Chess()
        newGame.load(data.fen)
        setGame(newGame)
        if (newGame.isGameOver()) {
          setStatus('Игра окончена')
        }
      }
    })
    return () => unsubscribe()
  }, [roomId])

  async function createRoom() {
    const id = generateRoomId()
    await set(ref(db, 'rooms/' + id), { fen: new Chess().fen() })
    setRoomId(id)
    setColor('w')
    window.history.replaceState(null, '', '?room=' + id)
  }

  async function joinRoom(id) {
    const snapshot = await get(ref(db, 'rooms/' + id))
    if (snapshot.exists()) {
      setRoomId(id)
      setColor('b')
    } else {
      setStatus('Комната не найдена')
    }
  }

  // Подсветка клеток, куда можно сходить
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
    set(ref(db, 'rooms/' + roomId), { fen: gameCopy.fen() })
    return true
  }

  const onDrop = useCallback((sourceSquare, targetSquare) => {
    const result = tryMove(sourceSquare, targetSquare)
    setMoveFrom('')
    setOptionSquares({})
    return result
  }, [game, color, roomId])

  function onDragBegin(piece, sourceSquare) {
    getMoveOptions(sourceSquare)
  }

  // Подсветка короля красным при шахе
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

  if (!roomId) {
    return (
      <div className="app-container">
        <div className="card">
          <h1>Web Chess</h1>
          <button onClick={createRoom}>Создать комнату</button>
          <p>{status}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="card board-card">
        <h2>Комната: {roomId}</h2>
        <p>Ты играешь за: {color === 'w' ? 'белых' : 'чёрных'}</p>
        <p className="link-text">Ссылка для друга: {window.location.href}</p>
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
        <p>{status}</p>
      </div>
    </div>
  )
}
