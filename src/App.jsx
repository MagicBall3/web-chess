import React, { useEffect, useState, useCallback } from 'react'
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

  const onDrop = useCallback((sourceSquare, targetSquare) => {
    if (game.turn() !== color) return false

    const gameCopy = new Chess(game.fen())
    let move
    try {
      move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      })
    } catch (e) {
      return false
    }

    if (move === null) return false

    setGame(gameCopy)
    set(ref(db, 'rooms/' + roomId), { fen: gameCopy.fen() })
    return true
  }, [game, color, roomId])

  if (!roomId) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <h1>Web Chess</h1>
        <button onClick={createRoom}>Создать комнату</button>
        <p>{status}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: '0 auto' }}>
      <h2>Комната: {roomId}</h2>
      <p>Ты играешь за: {color === 'w' ? 'белых' : 'чёрных'}</p>
      <p>Ссылка для друга: {window.location.href}</p>
      <Chessboard
        position={game.fen()}
        onPieceDrop={onDrop}
        boardOrientation={color === 'w' ? 'white' : 'black'}
      />
      <p>{status}</p>
    </div>
  )
}
