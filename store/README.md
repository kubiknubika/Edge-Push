# Материалы для релиза

| Файл | Назначение |
| --- | --- |
| `icon-512.png` | Иконка для Play Console (512×512, RGBA). |
| `feature-graphic.png` | Баннер 1024×500. |
| `screenshots/01-board.png` | Поле, HUD, D-pad, способности. |
| `screenshots/02-difficulty.png` | Переключатель 10 уровней сложности. |
| `screenshots/03-legend.png` | Легенда «КТО ЕСТЬ КТО». |
| `privacy-policy.md` | Текст политики (Markdown, для чтения). |
| `privacy-policy.html` | Готовая страница для HTTPS-URL в Play Console. |
| `data-safety.md` | Ответы на форму «Безопасность данных». |
| `listing-ru.md` / `listing-en.md` | Название, описания, «что нового», подсказки рейтинга. |
| `release-notes.md` | История версий. |
| `assetlinks.json` | **Шаблон** для `.well-known/assetlinks.json` (нужен только для TWA/веб-PWA). |

## Важно

- `assetlinks.json` содержит плейсхолдер. Замените его на SHA-256 сертификата подписи из Play Console → App Integrity (или `keytool -list -v`) **в двух местах**: здесь и в корневом `.well-known/assetlinks.json` (он уходит в `dist/` и в APK через `npm run assets:all`). Для нативной обёртки, где ассеты уже в APK, этот файл **не обязателен**; он нужен только для веб-PWA/TWA.
- Скриншоты и баннер пересобираются: `npm run store:screenshots`, `npm run store:art`, `npm run icons`.
- Для веб-PWA: `npm run pwa:build` создаёт `dist/` с игрой, политикой, `.nojekyll` и `/.well-known/assetlinks.json`. Выложите `dist/` на любой HTTPS-хостинг.
- Не коммитьте `android/keystore.properties`, `.jks`, `.keystore`, `.aab`, `.apk` — они в `.gitignore`.
