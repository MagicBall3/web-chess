# Заметки проекта web-chess

## Тесты
- Запуск: `npm test` (= `node --test`, автораспознавание). Node 22, встроенный runner, без доп. зависимостей. (Не использовать `node --test test/` — Node трактует путь как модуль.)
- Модули в `src/` импортируются с расширением `.js` (Node ESM требует явные расширения; Vite сам их добавляет).

## Окружение
- В `package.json` указан `chess.js@^1.0.0-beta.8`, но фактически установлен стабильный `1.4.0` (API: `loadPgn({strict})`, `history({verbose})`, `move({from,to,promotion})`).
- `npm install` в песочнице медленный: запускать в фоне с `--maxsockets=2` и длинным таймаутом.

## Известные исправления
- Была предсуществующая синтаксическая ошибка в `src/App.jsx` (дублированная строка `if (isFreeMove) {` в `tryMove`) — ломала сборку («Unexpected end of file»). Убрана, логика часов восстановлена.

## Анализ
- Новые модули анализатора: `src/analysisEngine.js` (движок: очередь, MultiPV, stop, abort, setOption, Elo), `src/gameTree.js` (дерево вариантов), `src/moveSelector.js` (человеческий выбор), `src/moveClassifier.js` (исправлена нормализация оценок). Существующий `src/stockfish.js` не тронут.
- Вкладка «Анализ партии»: `src/components/AnalysisTab.jsx` (рендерится из `App.jsx` при `view === 'analyzer'`, кнопка в главном меню). Использует `gameTree` + `analysisEngine` + `moveSelector`; режимы: live, кандидаты (MultiPV), рекомендации (стили), ревью. Свободное перемещение фигур создаёт ветки.
