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
- Модули анализатора: `src/analysisEngine.js` (движок: очередь, MultiPV, stop, abort, setOption, Elo, skillLevel), `src/gameTree.js` (дерево вариантов), `src/moveSelector.js` (режимы engine/human/practical + стили), `src/moveClassifier.js` (нормализация оценок), `src/heuristics.js` (реальные позиционные/тактические эвристики), `src/strength.js` (уровни силы: Skill Level / UCI_Elo). Существующий `src/stockfish.js` не тронут.
- Вкладка «Анализ партии»: `src/components/AnalysisTab.jsx` (рендерится из `App.jsx` при `view === 'analyzer'`, кнопка в главном меню). Режимы: Engine / Human / Practical / Custom Strength; ревью — кнопка в панели ходов. Свободное перемещение фигур создаёт ветки. Поворот доски (`boardOrientation`), подсветка последнего хода/выбранной клетки/возможных ходов, инфо-полоса (оценка, индикатор движка, лучший ход).
- График оценки позиции (`renderEvalGraph` в `AnalysisTab.jsx`): SVG-линейный график оценки по полуходам, цвет линии меняется от чёрного (преимущество чёрных) к белому (преимущество белых), текущая позиция помечена точкой, числовая оценка отображается рядом (например, -1,2 для преимущества чёрных). Оценки сохраняются в состоянии `evals` при каждом автоанализе позиции.
- Настройки вынесены в `src/components/SettingsPanel.jsx` (боковая панель/нижний экран), открывается кнопкой «⚙ Настройки». Чистые хелперы — `src/analysisUtils.js` (uciToSan, lastMoveSquares, legalTargets, isValidFen, ANALYSIS_MODES, MODE_DESC). Layout «доска в центре»: `.an-main` grid, мобильный <800px — одна колонка.
- WASM-сборка Stockfish 16 поддерживает `UCI_LimitStrength`, `UCI_Elo`, `Skill Level`, `MultiPV` (проверено по исходнику воркера).
