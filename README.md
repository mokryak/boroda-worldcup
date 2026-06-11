# Чемпионат по прогнозам Борода

Статический React/Vite сайт для дружеского прогнозного турнира. Участники заходят по ссылке, вводят имя, получают секретную ссылку для правок и сдают прогнозы по этапам. Данные хранятся в Google Sheets через Google Apps Script.

## Быстрый старт

```bash
npm install
npm run dev
```

Без `VITE_APPS_SCRIPT_URL` сайт работает в mock-режиме на `localStorage`, поэтому интерфейс можно проверить сразу.

## Google Sheet

1. Создайте новую Google Sheet.
2. Импортируйте CSV из папки `seed/` как отдельные листы:
   - `Settings`
   - `Stages`
   - `Matches`
   - `Participants`
   - `Predictions`
3. Откройте `Extensions -> Apps Script`.
4. Скопируйте содержимое `google-apps-script/Code.js`.
5. Запустите `setupWorldCupPredictor` один раз, если листы еще не созданы.
6. Deploy -> New deployment -> Web app:
   - Execute as: `Me`
   - Who has access: `Anyone`
7. Скопируйте Web App URL в `.env.local`:

```bash
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
```

### Live-счет

Live-счет подключен через API-Football free plan. Токен нельзя класть во фронтенд или git:

1. Создайте аккаунт на API-Football и подключите Free plan.
2. В Apps Script откройте `Project Settings -> Script Properties`.
3. Добавьте свойство `API_FOOTBALL_KEY` со значением API key.
4. Сохраните `Code.js` и сделайте `Deploy -> Manage deployments -> Edit -> New version -> Deploy`.
5. Запустите `installLiveScoreTrigger` один раз, если хотите, чтобы итоговый счет записывался даже когда сайт никто не открыл.

Apps Script дергает API-Football только если есть матч в live-окне: от 15 минут до старта и до 4 часов после старта, при этом в `Matches` еще нет финального счета. Ответ кэшируется примерно на 45 секунд. Когда API возвращает завершенный матч, Apps Script записывает итог в `Matches.actual_home`, `Matches.actual_away` и `Matches.status = complete`; после этого матч больше не запрашивается у внешнего API. Free plan дает 100 requests/day, поэтому не запускайте trigger чаще 1 раза в минуту.

Если сайт публикуется как GitHub Pages project site, например `https://user.github.io/worldcup/`, добавьте:

```bash
VITE_PUBLIC_BASE_PATH=/worldcup
```

## Администрирование турнира

- В начале тура прогнозы закрываются и открываются для всех со стартом первого матча тура.
- Для более поздних матчей прогнозы закрываются и открываются за 24 часа до старта конкретного матча.
- Время старта матчей правится в `Matches`, колонка `kickoff_at_utc`; именно она управляет блокировкой и раскрытием прогнозов.
- `Stages.deadline_utc` оставлен для совместимости, но больше не управляет сохранением прогнозов.
- Реальные счета правятся в `Matches`, колонки `actual_home` и `actual_away`.
- Команды плей-офф можно заменить в `Matches`, колонки `home` и `away`.
- До раскрытия API отдает только факт сдачи матча. Сами прогнозы возвращаются после 24-часового порога, а владельцу секретной ссылки дополнительно возвращаются его собственные скрытые прогнозы.

## Публикация на GitHub Pages

1. Создайте GitHub repository и запушьте проект.
2. Добавьте repository secret или локальный `.env.local` с `VITE_APPS_SCRIPT_URL`.
3. Соберите проект:

```bash
npm run build
```

4. Опубликуйте папку `dist` через GitHub Pages или настройте GitHub Actions. Скрипт сборки копирует `index.html` в `404.html`, поэтому прямые ссылки вроде `/edit/:token` работают на GitHub Pages.

## Проверки

```bash
npm test
npm run build
```

Календарь в `seed/Matches.csv` сгенерирован из публичной страницы Wikipedia по состоянию на 2026-06-10. Перед запуском турнира стоит сверить расписание с официальной страницей FIFA.
