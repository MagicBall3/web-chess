// gameTree.js — дерево шахматных вариантов.
//
// Линейная история ходов не подходит для свободного анализа: из одной позиции
// может быть несколько продолжений. Здесь каждая позиция — узел, каждый ход
// создаёт новый узел, а у узла может быть несколько детей (альтернативы).
//
// Основная линия = цепочка первых детей (mainChild) от корня. Альтернативные
// ходы добавляются как дополнительные дети и не уничтожают исходное продолжение.
//
// Все шахматные правила делегируются chess.js (легальность, FEN, PGN).

import { Chess } from 'chess.js'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export class GameNode {
  constructor({ fen, move = null, parent = null }) {
    this.fen = fen // FEN позиции
    this.move = move // verbose-объект хода (chess.js) или null для корня
    this.parent = parent
    this.children = [] // упорядочены; children[0] — основное продолжение
  }

  get isRoot() {
    return this.parent === null
  }

  get mainChild() {
    return this.children[0] || null
  }
}

export class GameTree {
  constructor({ initialFen = START_FEN } = {}) {
    this.root = new GameNode({ fen: initialFen })
    this.current = this.root
  }

  // === Построение ===

  /**
   * Применить ход из текущей позиции.
   * @param {string|object} move — SAN/UCI-строка или verbose-объект {from,to,promotion}
   * @param {object} opts
   * @param {boolean} [opts.asMain=false] — сделать новый ход основной линией (первым ребёнком)
   * @returns {GameNode}
   */
  playMove(move, { asMain = false } = {}) {
    const existing = this._findChildByMove(move)
    if (existing) {
      this.current = existing
      return existing
    }

    const chess = new Chess(this.current.fen)
    let played
    if (typeof move === 'string') {
      played = chess.move(move)
    } else {
      played = chess.move({ from: move.from, to: move.to, promotion: move.promotion })
    }
    if (!played) throw new Error('Illegal move: ' + JSON.stringify(move))

    const node = new GameNode({ fen: chess.fen(), move: played, parent: this.current })
    if (asMain) {
      this.current.children.unshift(node)
    } else {
      this.current.children.push(node)
    }
    this.current = node
    return node
  }

  /**
   * Загрузить партию из PGN (строит основную линию).
   */
  loadPgn(pgn, options = {}) {
    const chess = new Chess()
    chess.loadPgn(pgn, { strict: true, ...options })
    // Дерево строится с начальной позиции, затем ходы воспроизводятся заново.
    this.reset(START_FEN)
    const moves = chess.history({ verbose: true })
    for (const m of moves) {
      this.playMove(m)
    }
    return this
  }

  /**
   * Сброс к произвольной позиции (FEN).
   */
  reset(fen = START_FEN) {
    this.root = new GameNode({ fen })
    this.current = this.root
    return this
  }

  loadFen(fen) {
    return this.reset(fen)
  }

  // === Навигация ===

  goToStart() {
    this.current = this.root
    return this
  }

  goToEnd() {
    while (this.current.mainChild) this.current = this.current.mainChild
    return this
  }

  next() {
    if (this.current.mainChild) this.current = this.current.mainChild
    return this
  }

  prev() {
    if (this.current.parent) this.current = this.current.parent
    return this
  }

  goToNode(node) {
    if (node instanceof GameNode) this.current = node
    return this
  }

  /**
   * Перейти к позиции основной линии на той же глубине (том же числе полуходов),
   * что и текущий узел. Удобно для сравнения альтернативы с главной линией.
   */
  goToMainLine() {
    const depth = this.depthOf(this.current)
    let node = this.root
    for (let i = 0; i < depth && node.mainChild; i++) node = node.mainChild
    this.current = node
    return this
  }

  // === Запросы ===

  getFen() {
    return this.current.fen
  }

  /**
   * Ходы от корня до текущего узла (verbose-объекты chess.js).
   */
  getHistory() {
    const moves = []
    let node = this.current
    while (node && !node.isRoot) {
      moves.unshift(node.move)
      node = node.parent
    }
    return moves
  }

  /**
   * Легальные ходы из текущей позиции (verbose, как в chess.js).
   */
  legalMoves() {
    return new Chess(this.current.fen).moves({ verbose: true })
  }

  depthOf(node) {
    let d = 0
    let n = node
    while (n && !n.isRoot) {
      d++
      n = n.parent
    }
    return d
  }

  childrenOf(node = this.current) {
    return node.children
  }

  // === Внутреннее ===

  // Поиск уже существующего ребёнка по ходу. Не требует легальности хода в
  // текущей позиции (уже сыгранный ход может быть нелегален из неё), поэтому
  // сравниваем напрямую по полям/SAN.
  _findChildByMove(move) {
    if (typeof move === 'string') {
      const uci = move.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/)
      if (!uci) {
        // SAN: сравниваем с SAN детей
        for (const child of this.current.children) {
          if (child.move.san === move) return child
        }
        return null
      }
      const key = uci[1] + uci[2] + (uci[3] || '')
      for (const child of this.current.children) {
        if (child.move.from + child.move.to + (child.move.promotion || '') === key) return child
      }
      return null
    }

    const key = move.from + move.to + (move.promotion || '')
    for (const child of this.current.children) {
      if (child.move.from + child.move.to + (child.move.promotion || '') === key) return child
    }
    return null
  }
}
