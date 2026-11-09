import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import { GameTree, GameNode, START_FEN } from '../src/gameTree.js'

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5'

test('loadPgn: строит основную линию из PGN', () => {
  const tree = new GameTree()
  tree.loadPgn(PGN)
  assert.equal(tree.getHistory().length, 6)
  assert.equal(tree.depthOf(tree.current), 6)
  const chess = new Chess()
  chess.loadPgn(PGN)
  assert.equal(tree.current.fen, chess.fen())
})

test('FEN на каждой стадии совпадает с chess.js', () => {
  const tree = new GameTree()
  const chess = new Chess()
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) {
    tree.playMove(san)
    chess.move(san)
    assert.equal(tree.getFen(), chess.fen())
  }
})

test('ветвление: альтернативный ход не уничтожает основную линию', () => {
  const tree = new GameTree()
  tree.loadPgn(PGN)

  // возвращаемся к позиции после 2...Nc6 (полуход 4)
  tree.goToStart()
  for (let i = 0; i < 4; i++) tree.next()
  assert.equal(tree.depthOf(tree.current), 4)

  // вместо Bc4 играем Bb5
  const altNode = tree.playMove('Bb5')
  assert.equal(altNode.move.san, 'Bb5')

  // основная линия (первый ребёнок) сохранилась
  assert.equal(tree.current.parent.mainChild.move.san, 'Bc4')
  // альтернатива добавлена вторым ребёнком
  assert.equal(tree.current.parent.children.length, 2)
  assert.equal(tree.current.parent.children[1], altNode)
})

test('переключение между ветками и возврат к основной линии', () => {
  const tree = new GameTree()
  tree.loadPgn(PGN)

  tree.goToStart()
  for (let i = 0; i < 4; i++) tree.next()
  const altNode = tree.playMove('Bb5')

  // возвращаемся в узел ветвления и идём по основной линии
  tree.prev()
  tree.playMove('Bc4') // должен перейти к существующему основному ребёнку
  assert.equal(tree.current.move.san, 'Bc4')
  assert.equal(tree.current.parent.children.length, 2) // альтернатива не потеряна

  // из альтернативы goToMainLine возвращает к основной линии на той же глубине
  tree.goToNode(altNode)
  tree.goToMainLine()
  assert.equal(tree.current.move.san, 'Bc4')
  assert.equal(tree.depthOf(tree.current), 5)
})

test('навигация: next/prev/goToStart/goToEnd', () => {
  const tree = new GameTree()
  tree.loadPgn(PGN)

  tree.goToStart()
  assert.equal(tree.current.isRoot, true)

  tree.next()
  assert.equal(tree.current.move.san, 'e4')

  tree.goToEnd()
  assert.equal(tree.current.move.san, 'Bc5')

  tree.prev()
  assert.equal(tree.current.move.san, 'Bc4')
})

test('playMove: повторный ход не дублирует узел', () => {
  const tree = new GameTree()
  tree.playMove('e4')
  const first = tree.current
  tree.goToStart() // возвращаемся в начальную позицию
  tree.playMove('e4') // повторный вызов того же хода
  assert.equal(tree.current, first)
  assert.equal(tree.root.children.length, 1)
})

test('нелегальный ход выбрасывает ошибку', () => {
  const tree = new GameTree()
  assert.throws(() => tree.playMove('e5'))
})

test('loadFen: произвольная позиция', () => {
  const tree = new GameTree()
  const fen = '8/8/8/8/8/8/8/K6k w - - 0 1'
  tree.loadFen(fen)
  assert.equal(tree.getFen(), fen)
  assert.ok(tree.legalMoves().length > 0)
})

test('legalMoves делегирует chess.js', () => {
  const tree = new GameTree()
  tree.playMove('e4')
  const chess = new Chess()
  chess.move('e4')
  const expected = chess.moves({ verbose: true }).length
  assert.equal(tree.legalMoves().length, expected)
})

test('GameNode.mainChild возвращает первого ребёнка', () => {
  const tree = new GameTree()
  tree.playMove('e4')
  assert.ok(tree.root.mainChild instanceof GameNode)
  assert.equal(tree.root.mainChild.move.san, 'e4')
})

test('стартовая FEN по умолчанию', () => {
  const tree = new GameTree()
  assert.equal(tree.getFen(), START_FEN)
})
