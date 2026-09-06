let worker = null
let readyPromise = null

function getWorker() {
  if (!worker) {
    worker = new Worker('https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.js')
  }
  return worker
}

export function initEngine() {
  if (readyPromise) return readyPromise
  readyPromise = new Promise((resolve) => {
    const w = getWorker()
    function onMsg(e) {
      const line = e.data
      if (line === 'uciok') {
        w.postMessage('isready')
      }
      if (line === 'readyok') {
        w.removeEventListener('message', onMsg)
        resolve()
      }
    }
    w.addEventListener('message', onMsg)
    w.postMessage('uci')
  })
  return readyPromise
}

// Возвращает { score: { type: 'cp'|'mate', value }, bestMove }
// score дан с точки зрения того, чей сейчас ход (стандарт UCI)
export function evaluatePosition(fen, depth = 12) {
  return new Promise(async (resolve) => {
    await initEngine()
    const w = getWorker()
    let bestScore = null
    let bestMove = null

    function onMsg(e) {
      const line = e.data
      if (typeof line !== 'string') return

      if (line.startsWith('info') && line.includes(' score ')) {
        const cpMatch = line.match(/score cp (-?\d+)/)
        const mateMatch = line.match(/score mate (-?\d+)/)
        if (cpMatch) bestScore = { type: 'cp', value: parseInt(cpMatch[1], 10) }
        if (mateMatch) bestScore = { type: 'mate', value: parseInt(mateMatch[1], 10) }
      }

      if (line.startsWith('bestmove')) {
        bestMove = line.split(' ')[1]
        w.removeEventListener('message', onMsg)
        resolve({ score: bestScore, bestMove })
      }
    }

    w.addEventListener('message', onMsg)
    w.postMessage('position fen ' + fen)
    w.postMessage('go depth ' + depth)
  })
}
