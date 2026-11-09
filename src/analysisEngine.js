// analysisEngine.js — надёжная обёртка над Stockfish (UCI) для будущего анализатора.
//
// Возможности:
//   * Инициализация UCI: uci -> uciok -> isready -> readyok, обработка ошибок Worker.
//   * MultiPV: получение нескольких лучших вариантов (setoption name MultiPV value N).
//   * Серийная очередь запросов — на одном Worker одновременно выполняется только один поиск.
//   * stop() через UCI-команду "stop" и корректное ожидание bestmove.
//   * Защита от устаревших результатов: монотонный номер запроса, игнор поздних сообщений.
//   * Инъекция фейкового Worker для тестов.

const DEFAULT_WORKER_URL = '/stockfish/stockfish-nnue-16-single.js'

// Разбор строки "info ..." в { multipv, score, depth, pv }.
function parseInfoLine(line) {
  const parts = line.split(' ')
  let multipv = 1
  let score = null
  let depth = null
  let pv = []

  for (let i = 0; i < parts.length; i++) {
    const token = parts[i]
    if (token === 'multipv') {
      multipv = parseInt(parts[i + 1], 10) || 1
    } else if (token === 'score') {
      const type = parts[i + 1]
      const value = parseInt(parts[i + 2], 10)
      if (type === 'cp' || type === 'mate') score = { type, value }
    } else if (token === 'depth') {
      depth = parseInt(parts[i + 1], 10) || null
    } else if (token === 'pv') {
      pv = parts.slice(i + 1).filter(Boolean)
      break
    }
  }

  if (!score && pv.length === 0) return null
  return { multipv, score, depth, pv }
}

export class AnalysisEngine {
  /**
   * @param {object} options
   * @param {Worker|null} options.worker  — готовый Worker (для тестов); иначе создаётся из workerUrl
   * @param {string} options.workerUrl    — путь к воркеру Stockfish
   */
  constructor({ worker = null, workerUrl = DEFAULT_WORKER_URL } = {}) {
    this.workerUrl = workerUrl
    this.worker = worker || new Worker(workerUrl)
    this.readyPromise = null
    this.requestSeq = 0
    this.currentRequest = null
    this.queue = []
    this.running = false

    this._boundOnMessage = (e) => this._handleWorkerMessage(e)
    this._boundOnError = (err) => this._handleWorkerError(err)
    this.worker.addEventListener('message', this._boundOnMessage)
    this.worker.addEventListener('error', this._boundOnError)
  }

  // Инициализация UCI. Возвращает Promise, резолвится после readyok.
  init() {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise((resolve, reject) => {
      const onMsg = (e) => {
        const line = e.data
        if (line === 'uciok') {
          this.worker.postMessage('isready')
        } else if (line === 'readyok') {
          this.worker.removeEventListener('message', onMsg)
          this.worker.removeEventListener('error', onErr)
          resolve()
        }
      }
      const onErr = () => {
        this.worker.removeEventListener('message', onMsg)
        this.worker.removeEventListener('error', onErr)
        reject(new Error('Stockfish worker failed during UCI init'))
      }
      this.worker.addEventListener('message', onMsg)
      this.worker.addEventListener('error', onErr)
      this.worker.postMessage('uci')
    })
    return this.readyPromise
  }

  /**
   * Запуск анализа позиции.
   * @param {object} options
   * @param {string} options.fen       — позиция в FEN
   * @param {number} [options.depth]   — глубина поиска
   * @param {number} [options.movetime]— лимит времени в мс
   * @param {number} [options.nodes]   — лимит узлов
   * @param {number} [options.multiPv] — число вариантов (MultiPV)
   * @returns {Promise<Array<AnalysisResult>>}
   */
  analyze(options = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ options, resolve, reject })
      this._pump()
    })
  }

  // Останавливает текущий поиск (UCI "stop"). Запрос завершится с уже
  // собранными вариантами; очередь продолжит работу.
  stop() {
    if (this.currentRequest && this.worker) {
      this.worker.postMessage('stop')
    }
  }

  // Устанавливает произвольную UCI-опцию (setoption name X value Y).
  // Применяется после инициализации; не влияет на уже выполняющийся поиск.
  setOption(name, value) {
    return this.init().then(() => {
      if (this.worker) {
        this.worker.postMessage('setoption name ' + name + ' value ' + value)
      }
    })
  }

  // Отменяет все ожидающие запросы и останавливает текущий поиск.
  // Текущий запрос завершится с уже собранными вариантами; очередь очищается.
  abort() {
    this.queue = []
    if (this.currentRequest && this.worker) {
      this.worker.postMessage('stop')
    }
  }

  // Полностью закрывает движок и сбрасывает очередь.
  terminate() {
    this.worker.removeEventListener('message', this._boundOnMessage)
    this.worker.removeEventListener('error', this._boundOnError)
    this.worker.terminate()
    this.worker = null
    this.readyPromise = null
    this.currentRequest = null
    this.queue = []
    this.running = false
  }

  // --- внутреннее ---

  _pump() {
    if (this.running || this.queue.length === 0) return
    const job = this.queue.shift()
    this.running = true
    this._execute(job)
      .catch(() => {
        // ошибка уже передана в job.reject; здесь просто не даём ей стать
        // необработанным отклонением промиса _execute
      })
      .finally(() => {
        this.running = false
        this._pump()
      })
  }

  // Выполняет один запрос. Возвращаемый Promise резолвится только после
  // получения bestmove (т.е. после фактического завершения поиска).
  _execute(job) {
    const { options, resolve: jobResolve, reject: jobReject } = job

    return new Promise((settleResolve, settleReject) => {
      this.init()
        .then(() => {
          const seq = ++this.requestSeq
          const req = {
            seq,
            options,
            lines: new Map(), // multipv -> { multipv, score, depth, pv }
            settle: (results) => {
              jobResolve(results)
              settleResolve()
            },
            fail: (err) => {
              jobReject(err)
              settleReject(err)
            },
          }
          this.currentRequest = req
          this._startSearch(req)
        })
        .catch((err) => {
          jobReject(err)
          settleReject(err)
        })
    })
  }

  _startSearch(req) {
    const w = this.worker
    const options = req.options

    // Регулировка силы. Используем ровно один механизм, чтобы не конфликтовать:
    //   - elo       -> UCI_LimitStrength + UCI_Elo
    //   - skillLevel -> Skill Level (0–20)
    if (options.elo != null) {
      w.postMessage('setoption name UCI_LimitStrength value true')
      w.postMessage('setoption name UCI_Elo value ' + options.elo)
    } else if (options.skillLevel != null) {
      w.postMessage('setoption name Skill Level value ' + options.skillLevel)
    }

    const multiPv = Math.max(1, parseInt(options.multiPv, 10) || 1)
    w.postMessage('setoption name MultiPV value ' + multiPv)
    w.postMessage('position fen ' + options.fen)

    let go = 'go'
    if (options.depth != null) go += ' depth ' + options.depth
    if (options.movetime != null) go += ' movetime ' + options.movetime
    if (options.nodes != null) go += ' nodes ' + options.nodes
    if (go === 'go') go += ' depth 12'
    w.postMessage(go)
  }

  _handleWorkerMessage(e) {
    const line = e.data
    if (typeof line !== 'string') return

    const req = this.currentRequest
    if (!req) return // устаревшее сообщение без активного запроса

    if (line.startsWith('info')) {
      const parsed = parseInfoLine(line)
      if (parsed) req.lines.set(parsed.multipv, parsed)
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(' ')
      const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null
      const results = this._buildResults(req, bestMove)
      this.currentRequest = null
      req.settle(results)
    }
  }

  _handleWorkerError(err) {
    const req = this.currentRequest
    if (req) {
      this.currentRequest = null
      req.fail(new Error('Stockfish worker error: ' + (err && err.message)))
    }
  }

  _buildResults(req, bestMove) {
    const entries = Array.from(req.lines.values()).sort((a, b) => a.multipv - b.multipv)

    if (entries.length === 0) {
      return [
        {
          multipv: 1,
          score: null,
          depth: null,
          pv: bestMove ? [bestMove] : [],
          bestMove,
        },
      ]
    }

    return entries.map((en) => ({
      multipv: en.multipv,
      score: en.score,
      depth: en.depth,
      pv: en.pv,
      bestMove: en.pv[0] || bestMove,
    }))
  }
}
