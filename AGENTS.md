# Agent Handoff Notes

Короткий контекст для новой сессии Codex по проекту `boroda-worldcup`.

## Что это

React/Vite сайт дружеского турнира прогнозов. Фронтенд статически лежит на GitHub Pages, данные хранятся в Google Sheets через Google Apps Script.

- Прод: `https://mokryak.github.io/boroda-worldcup/`
- Apps Script Web App: `https://script.google.com/macros/s/AKfycbz55YLbFiTIn6OpFTHpmtpprRVQB25PvHipc50nXpO3JSVCtUphm1Zk4AcnesHfxW4r/exec`
- Google Sheet: `https://docs.google.com/spreadsheets/d/1A7lCC4SmifWolSXWtchwM6We_tEtRrSzcqM94Ip1gnQ/edit`
- Основная ветка: `main`
- GitHub Pages ветка: `gh-pages`

## Важные файлы

- `src/` - React приложение.
- `src/domain/visibility.ts` - правила открытия/блокировки прогнозов.
- `src/domain/scoring.ts` - начисление очков: точный счет 5, разница 4, исход 3.
- `src/domain/selectors.ts` - таблицы, лидерборд, очки по матчам.
- `src/pages/ResultsPage.tsx` - таблица прогнозов и окно матча.
- `src/pages/PredictPage.tsx` - форма прогнозов по секретной ссылке.
- `src/api/client.ts` - Apps Script клиент и mock `localStorage`.
- `google-apps-script/Code.js` - backend для Google Sheets и live-score.
- `seed/` - CSV для начальной структуры Google Sheet.
- `scripts/deploy-pages.mjs` - публикация `dist` в `gh-pages`, если нужен ручной deploy.

## Бизнес-правила

- При заходе на сайт по умолчанию открывается таблица результатов.
- Прогноз можно менять по секретной ссылке только пока он не стал публичным.
- На первом матче тура прогнозы закрываются и открываются со стартом первого матча тура.
- На более поздних матчах прогнозы закрываются и открываются за 24 часа до старта конкретного матча.
- Закрытые матчи остаются видимыми в форме, но поля disabled; более поздние матчи все еще можно редактировать.
- Владелец секретной ссылки видит свои скрытые прогнозы до публичного открытия.
- Остальные участники до открытия видят только факт сдачи прогноза.
- Время матчей показывается пользователю в локальном часовом поясе.

## Live-score

Источник текущего/итогового счета: TheSportsDB, endpoint:

```text
https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=South_Korea_vs_Czech_Republic
```

Ключей API во фронтенде и git нет. Apps Script дергает провайдера только для матчей без итогового счета:

- live-окно: от 15 минут до старта и до 4 часов после старта;
- final lookback: до 48 часов после старта;
- успешные fixture-ответы кэшируются на 5 минут;
- пустые ответы не кэшируются;
- если провайдер завис в `LIVE`/`2H`, но счет уже есть, матч финализируется по времени:
  - групповой этап: через 130 минут после kickoff;
  - плей-офф: через 210 минут после kickoff.

После финализации Apps Script пишет в `Matches.actual_home`, `Matches.actual_away`, `Matches.status = complete`. Такой матч больше не дергает внешний API.

Полезная диагностика:

```text
https://script.google.com/macros/s/AKfycbz55YLbFiTIn6OpFTHpmtpprRVQB25PvHipc50nXpO3JSVCtUphm1Zk4AcnesHfxW4r/exec?action=liveDebug
```

## Apps Script deploy

Если менялся `google-apps-script/Code.js`, GitHub Pages не обновляется автоматически. Нужно:

1. Открыть Apps Script из Google Sheet.
2. Полностью заменить код на `google-apps-script/Code.js`.
3. `Deploy -> Manage deployments -> Edit -> New version -> Deploy`.
4. Если менялась логика триггера, вручную запустить `installLiveScoreTrigger`.

Важные функции:

- `setupWorldCupPredictor` - создает листы/заголовки.
- `installLiveScoreTrigger` - ставит cron каждые 5 минут.
- `refreshLiveScoresCron` - cron-обновление итоговых счетов.
- `getLiveScoreDebug_` - диагностика live-score.
- `savePredictions_` - сохраняет только редактируемые матчи.

## Frontend deploy

Если менялся фронтенд:

```bash
npm test
npm run build
npm run deploy:pages
```

Проверить, что `gh-pages` обновился, затем открыть прод. Для GitHub Pages важен `404.html`, он копируется из `index.html` скриптом сборки, чтобы работали прямые ссылки `/edit/:token`.

## Проверки перед ответом пользователю

Минимум:

```bash
npm test
npm run build
```

Если менялся только `google-apps-script/Code.js`:

```bash
node --check google-apps-script/Code.js
npm test
```

После Apps Script redeploy полезно открыть:

```text
<WEB_APP_URL>?action=liveDebug
<WEB_APP_URL>?action=state
```

## Аккуратность

- Не класть секреты/API токены в git.
- Не трогать чужие изменения в рабочем дереве.
- При проблемах live-score сначала сравнить прямой ответ TheSportsDB и `liveDebug`.
- Если сайт белый на GitHub Pages, проверить `base`/`VITE_PUBLIC_BASE_PATH`, `404.html` и свежесть `gh-pages`.
