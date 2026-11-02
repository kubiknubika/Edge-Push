# КРАЙ / Edge Push · подготовка к релизу на Android

**Версия:** 1.0.0 · **package:** `com.kubiknubika.edgepush` · **каналы:** Google Play (AAB) и прямой APK.

В репозитории готов **полный исходный комплект**: installable PWA, нативный Android-проект,
материалы магазина, политика, автоматическая проверка и чек-лист ниже. Бинарного
`app-release.aab` / `app-release.apk` здесь нет: в песочнице отсутствуют Android SDK, JDK и
`keytool`, поэтому сборка и подпись выполняются на вашей машине (п. 2–3). Это не «заглушка»:
проект содержит настоящий Gradle wrapper, `AndroidManifest.xml`, `MainActivity.java`,
ресурсы, адаптивную иконку и точную копию веб-ассетов в `app/src/main/assets/www/`.

---

## 0. Что уже подготовлено

| Область | Файлы | Статус |
| --- | --- | --- |
| Игра | `index.html` | Без изменений в механике; добавлены только manifest-ссылки, `env(safe-area-inset-top)` и аккуратная регистрация SW. |
| PWA | `manifest.json`, `sw.js`, `favicon.svg`, `apple-touch-icon.png`, `icons/` | 192/512 + maskable 192/512, офлайн-кэш игры/отчёта/политики, портретный `standalone`. |
| Android | `android/` | AGP 8.13.0 + Gradle 8.13, `compileSdk/targetSdk 36`, `minSdk 26`, `WebViewAssetLoader`, только `VIBRATE`, без `INTERNET`. |
| Ассеты APK | `android/app/src/main/assets/www/` | Синхронизируются командой `npm run android:assets`; контроль хэшей в `release:check`. |
| Магазин | `store/` | Иконка 512, баннер 1024×500, 3 скриншота 390×780, листинг RU/EN, политика, Data safety, assetlinks, release notes. |
| Автоматизация | `scripts/`, `tests/release.test.mjs` | `icons`, `store:art`, `store:screenshots`, `android:assets`, `pwa:build`, `release:check`, `version:bump`. |

---

## 1. Требования к машине сборки

- **Android Studio** актуальной стабильной версии (или CLI Android SDK).
- **JDK 17** — минимум для AGP 8.13 / Gradle 8.13.
- **Android SDK Platform 36** и **SDK Build Tools 36.0.0**.
- Gradle ставить вручную не надо: `android/gradlew` + `gradle-wrapper.jar` уже в репозитории,
  `gradle-wrapper.properties` тянет `gradle-8.13-bin.zip`.
- Node.js 22+ и `npm ci` — для проверок и пересборки ассетов.

Почему именно API 36: с 31 августа 2026 Play принимает новые приложения и обновления для
телефонов только с `targetSdk 36` (Android 16) или выше ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)).
Совместимость AGP/Gradle и максимум API 36 — [AGP 8.13 release notes](https://developer.android.com/build/releases/agp-8-13-0-release-notes).

---

## 2. Обязательный gate перед любой сборкой

```bash
cd /home/user/Edge-Push
npm ci
npm test                    # 124 теста: 72 игровых/ИИ + 52 релизных
npm run release:check        # распечатает все пункты; любой [FAIL] блокирует релиз
npm run android:assets       # если менялся index.html / sw.js / иконки / отчёт
```

`release:check` сверяет версии в `package.json`, `package-lock.json`, `sw.js` и
`android/app/build.gradle`, размеры PNG, manifest, отсутствие `INTERNET`, синхронность
APK-ассетов, политику, `assetlinks.json`, `.gitignore` и отсутствие секретов в Git.

Если менялась графика:

```bash
npm run icons                                  # иконки + лаунчеры + favicon
npm run store:art                              # баннер (ImageMagick + DejaVu)
npm start                                      # в другом терминале
CHROMIUM_PATH=/путь/к/chrome npm run store:screenshots
npm run assets:all                            # пересинхронизировать APK и dist
npm run release:check
```

---

## 3. Ключ подписи (один раз)

```bash
cd android
keytool -genkeypair -v \
  -keystore release.keystore \
  -alias edge-push \
  -keyalg RSA -keysize 2048 -validity 10000
cp keystore.properties.example keystore.properties
# заполните storePassword / keyPassword; storeFile=release.keystore уже указан
```

- `keystore.properties`, `release.keystore`, `*.jks`, `*.aab`, `*.apk` **в `.gitignore`** — не коммитьте.
- Надёжно сохраните keystore и пароли: без них невозможны обновления приложения.
- Для Play рекомендуется **Play App Signing**: загрузите AAB, подписанный upload-ключом.
  Прямой APK из п. 5 логичнее подписывать тем же upload-ключом, но учтите: Play переподписывает
  свои раздачи app-signing-ключом, поэтому APK «сбоку» **не будет обновлением** для копии,
  установленной из Play. Это разные каналы установки.

Без `keystore.properties` release-сборка получится **неподписанной** — используйте её только
для проверки, не для публикации.

---

## 4. Сборка AAB для Google Play

```bash
cd android
./gradlew :app:clean :app:bundleRelease
# результат: app/build/outputs/bundle/release/app-release.aab
```

Проверьте перед загрузкой: `targetSdk 36`, `versionCode 1`, `versionName 1.0.0`,
`applicationId com.kubiknubika.edgepush`, в merged manifest нет `android.permission.INTERNET`,
есть только `VIBRATE`.

---

## 5. Сборка APK для прямой раздачи

```bash
cd android
./gradlew :app:assembleRelease
# результат: app/build/outputs/apk/release/app-release.apk
sha256sum app/build/outputs/apk/release/app-release.apk
```

Опубликуйте APK вместе с контрольной суммой, версией, `minSdk 26` и предупреждением, что для
установки вне Play нужно разрешить источник. Для обновлений сохраняйте тот же ключ и тот же
`applicationId`.

---

## 6. Проверка на реальном устройстве (перед публикацией)

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Чек-лист:

- [ ] Запуск в самолётном режиме: игра и отчёт ИИ открываются без сети.
- [ ] Портрет заблокирован, нет скролла и обрезки HUD/D-pad на маленьком экране.
- [ ] Крестовина, свайп 30px, крюк/бросок/ожидание; «НЕТ ПУТИ» заметен и не тратит ход.
- [ ] Вибрация работает, автосохранение восстанавливает партию после перезапуска.
- [ ] Обучение, легенда `L`, переключатель сложности `C` / `СЛ`, 10 уровней.
- [ ] Кнопка «Понятно» и все элементы легенды нажимаются.
- [ ] Кнопка «Назад» закрывает внутренние экраны, а не вылетает случайно.
- [ ] В логах нет обращений в сеть и ошибок WebView.

---

## 7. Публикация в Google Play

1. Play Console → новое приложение → название `КРАЙ · Edge Push`, категория **Игры → Головоломки**.
2. Загрузите `app-release.aab`. Убедитесь, что Console видит target API 36.
3. **Описание:** скопируйте из `store/listing-ru.md` (при желании `listing-en.md`).
4. **Что нового:** `store/release-notes.md`.
5. **Графика:** `store/icon-512.png`, `store/feature-graphic.png`,
   `store/screenshots/01-board.png`, `02-difficulty.png`, `03-legend.png`.
6. **Политика конфиденциальности:** выложите `store/privacy-policy.html` на HTTPS-домен
   (например, `npm run pwa:build` → `dist/privacy-policy.html`) и укажите этот URL.
7. **Безопасность данных:** ответы в `store/data-safety.md` — «данные не собираются/не передаются».
8. **Возрастной рейтинг:** пройдите опросник, подсказки в `store/listing-ru.md`; не заявляйте
   рейтинг до ответа Console.
9. **Целевая аудитория, реклама, покупки:** рекламы нет, покупок нет, аккаунта нет.
10. Сохраните черновик, прогоните внутреннее/закрытое тестирование, затем выпуск.

---

## 8. Прямой APK и веб-PWA

- Прямой APK: п. 5 + `sha256sum` + `store/release-notes.md`.
- PWA: `npm run pwa:build` создаёт `dist/` (игра, SW, иконки, отчёт, `privacy-policy.html`,
  `/.well-known/assetlinks.json`, `.nojekyll`). Выложите содержимое `dist/` на любой HTTPS.
  Chrome на Android предложит «Установить приложение»; офлайн работает после первого визита.
- `store/assetlinks.json` и корневой `.well-known/assetlinks.json` — **одинаковые шаблоны**.
  Замените `REPLACE_WITH_APP_SIGNING_CERT_SHA256` на отпечаток сертификата из
  Play Console → App Integrity **в обоих файлах**, затем `npm run assets:all`.
  Для нативной обёртки файл не нужен: он пригодится, если позже сделаете Trusted Web Activity
  поверх веб-PWA. `release:check` следит, чтобы две копии не разошлись.

Maskable-иконки нарисованы с запасом: вся важная графика внутри центрального круга Ø80%,
поэтому круг/скруглённый квадрат/«капля» лаунчера ничего не обрежут
([safe zone](https://web.dev/articles/maskable-icon)).

---

## 9. Следующая версия

```bash
npm run version:bump 1.0.1
# обновит package.json, package-lock.json, versionName/Code, CACHE_NAME sw.js,
# release notes и упоминания версии в документах, затем пересинхронизирует ассеты
npm run release:check
```

`versionCode` увеличивается автоматически; не меняйте его вручную. После сборки обязательно
повторите п. 6 на устройстве.

---

## 10. Известное

На очень маленьких/низких экранах D-pad может быть меньше 64px, чтобы сохранить 45% высоты под
управление без прокрутки. Компромисс описан в `README.md` и сохранён осознанно.

---

## Итог

Всё, что можно подготовить без Android SDK, подготовлено и проверено `npm run release:check`.
Осталось три действия на вашей машине: создать keystore, собрать подписанные AAB/APK командами
из п. 4–5 и загрузить материалы из `store/` в Play Console.
