import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AnalysisEngine } from '../src/analysisEngine.js'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

// Фейковый Worker, имитирующий UCI-ответы Stockfish.
class FakeWorker {
  constructor({ manual = false } = {}) {
    this.manual = manual
    this.listeners = { message: [], error: [] }
    this.sent = []
    this.lastMultiPv = 1
  }

  addEventListener(type, fn) {
    this.listeners[type].push(fn)
  }

  removeEventListener(type, fn) {
    this.listeners[type] = this.listeners[type].filter((f) => f !== fn)
  }

  _emit(line) {
    for (const fn of this.listeners.message) fn({ data: line })
  }

  _emitError(err) {
    for (const fn of this.listeners.error) fn(err)
  }

  postMessage(msg) {
    this.sent.push(msg)
    if (typeof msg !== 'string') return

    if (msg === 'uci') this._emit('uciok')
    else if (msg === 'isready') this._emit('readyok')
    else if (msg.startsWith('setoption')) {
      const m = msg.match(/MultiPV value (\d+)/)
      if (m) this.lastMultiPv = parseInt(m[1], 10)
    } else if (msg.startsWith('go')) {
      if (!this.manual) this._respondToGo()
    }
  }

  _respondToGo() {
    const n = this.lastMultiPv
    for (let i = 1; i <= n; i++) {
      const score = 30 - i * 10
      const pv = ['e2e4', 'e7e5', 'g1f3'].slice(0, 1 + (i % 3))
      this._emit(`info depth 12 multipv ${i} score cp ${score} pv ${pv.join(' ')}`)
    }
    this._emit('bestmove e2e4')
  }

  terminate() {
    this.terminated = true
  }
}

test('init: последовательность uci -> uciok -> isready -> readyok', async () => {
  const w = new FakeWorker()
  const eng = new AnalysisEngine({ worker: w })
  await eng.init()
  assert.ok(w.sent.includes('uci'))
  assert.ok(w.sent.includes('isready'))
})

test('MultiPV: возвращает несколько вариантов, отсортированных по multipv', async () => {
  const eng = new AnalysisEngine({ worker: new FakeWorker() })
  const res = await eng.analyze({ fen: START_FEN, multiPv: 3, depth: 12 })

  assert.equal(res.length, 3)
  assert.equal(res[0].multipv, 1)
  assert.equal(res[0].bestMove, 'e2e4')
  assert.equal(res[0].score.value, 20) // 30 - 1*10
  assert.equal(res[1].score.value, 10) // 30 - 2*10
  assert.equal(res[2].score.value, 0) // 30 - 3*10
  assert.deepEqual(res[0].pv, ['e2e4', 'e7e5'])
})

test('очередь: запросы выполняются серийно и оба резолвятся', async () => {
  const eng = new AnalysisEngine({ worker: new FakeWorker() })
  const p1 = eng.analyze({ fen: START_FEN, multiPv: 1 })
  const p2 = eng.analyze({ fen: START_FEN, multiPv: 1 })

  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1[0].bestMove, 'e2e4')
  assert.equal(r2[0].bestMove, 'e2e4')

  const goCount = eng.worker.sent.filter((s) => typeof s === 'string' && s.startsWith('go')).length
  assert.equal(goCount, 2)
})

test('stop: прерывает поиск и завершает запрос с уже собранными вариантами', async () => {
  const w = new FakeWorker({ manual: true })
  const eng = new AnalysisEngine({ worker: w })

  const prom = eng.analyze({ fen: START_FEN, multiPv: 2, movetime: 1000 })
  await new Promise((r) => setTimeout(r, 0)) // даём дойти до go

  assert.ok(w.sent.some((s) => typeof s === 'string' && s.startsWith('go')))
  eng.stop()
  assert.ok(w.sent.includes('stop'))

  w._emit('info depth 10 multipv 1 score cp 15 pv e2e4')
  w._emit('bestmove e2e4')

  const res = await prom
  assert.equal(res[0].bestMove, 'e2e4')
  assert.equal(res[0].score.value, 15)
})

test('защита от устаревших результатов: поздний bestmove игнорируется', async () => {
  const w = new FakeWorker({ manual: true })
  const eng = new AnalysisEngine({ worker: w })

  const prom = eng.analyze({ fen: START_FEN, multiPv: 1 })
  await new Promise((r) => setTimeout(r, 0))
  w._emit('bestmove e2e4')
  await prom

  assert.equal(eng.currentRequest, null)
  // позднее сообщение не должно вызвать ошибку и не должно создать новый запрос
  w._emit('bestmove g1f3')
  assert.equal(eng.currentRequest, null)
})

test('ошибка Worker отклоняет текущий запрос', async () => {
  const w = new FakeWorker({ manual: true })
  const eng = new AnalysisEngine({ worker: w })

  const prom = eng.analyze({ fen: START_FEN })
  await new Promise((r) => setTimeout(r, 0))
  w._emitError(new Error('boom'))
  await assert.rejects(prom)
})

test('повторный запуск анализа на новой позиции даёт свежий результат', async () => {
  const eng = new AnalysisEngine({ worker: new FakeWorker() })
  const r1 = await eng.analyze({ fen: START_FEN, multiPv: 1 })
  const r2 = await eng.analyze({ fen: START_FEN, multiPv: 1 })
  assert.equal(r1[0].bestMove, 'e2e4')
  assert.equal(r2[0].bestMove, 'e2e4')
})

test('setOption: отправляет setoption name X value Y после инициализации', async () => {
  const w = new FakeWorker()
  const eng = new AnalysisEngine({ worker: w })
  await eng.setOption('Threads', '1')
  assert.ok(w.sent.includes('setoption name Threads value 1'))
})

test('Elo: при заданной силе шлёт UCI_LimitStrength и UCI_Elo перед go', async () => {
  const w = new FakeWorker()
  const eng = new AnalysisEngine({ worker: w })
  await eng.analyze({ fen: START_FEN, multiPv: 1, elo: 1500 })

  assert.ok(w.sent.includes('setoption name UCI_LimitStrength value true'))
  assert.ok(w.sent.includes('setoption name UCI_Elo value 1500'))
  const goIdx = w.sent.findIndex((s) => typeof s === 'string' && s.startsWith('go'))
  const eloIdx = w.sent.indexOf('setoption name UCI_Elo value 1500')
  assert.ok(eloIdx !== -1 && eloIdx < goIdx, 'Elo должен устанавливаться до go')
})

test('Elo: без заданной силы не шлёт UCI_LimitStrength', async () => {
  const w = new FakeWorker()
  const eng = new AnalysisEngine({ worker: w })
  await eng.analyze({ fen: START_FEN, multiPv: 1 })
  assert.ok(!w.sent.includes('setoption name UCI_LimitStrength value true'))
})
