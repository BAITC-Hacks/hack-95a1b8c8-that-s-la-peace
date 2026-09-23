# That's La Peace — автономный Windows-пакет

Запуск для жюри одним нажатием описан в [основном README](../README.md). `ContractorPicker.exe` содержит Python, backend, восемь публичных файлов интерфейса, исходный каталог из 66 профилей и notices. Python, Git, pip, Node.js, аккаунты и интернет для обычного запуска EXE не нужны. Имя продукта в интерфейсе — **That's La Peace**; техническое имя EXE сохранено для совместимости с START.

## Происхождение сборки

- Runtime-исходники: `f7a1980cf47dc77f2bb13115d974b0e00b3cc35f`.
- Сборка: 23.09.2026, 17:41:52–17:42:21 UTC+05:00; Python **3.12.10 AMD64**, PyInstaller **6.22.3**, hooks **2026.7**.
- Файл: `ContractorPicker.exe`, **15 668 260 байт**, Windows PE x64 (`0x8664`).
- SHA-256: `cb7d3b3188ac1f4f00ce0cc6c433a8c11c3b7d05a0e0434652788e7797972457`.
- [build-info.json](build-info.json) содержит фактический argv, время, SHA-256 каждого входного файла и подтверждение неизменности входов во время сборки. Абсолютные пути в нём относятся к машине сборки.
- EXE проверен из отдельной папки с PATH только Windows/System32, без PYTHONHOME/PYTHONPATH/VIRTUAL_ENV: health=66, настоящий HTTP smoke, две даты, стабильный повтор, редкая категория, оба пустых исхода и оба проверяемых совета — PASS. Созданное дерево процессов остановлено; порт после проверки закрыт. Это не заявление о проверке каждой версии Windows.

## Лицензии и зависимости

[licenses/](licenses/) содержит **42 полных текста LICENSE/COPYING/NOTICE**, включая Python и вложенные notices, а также метаданные 22 установленных distributions. [manifest.json](licenses/manifest.json) фиксирует версии, роли и хеши. PyInstaller COPYING включает исключение для распространения приложений со встроенным bootloader; полный текст сохранён. Папку licenses следует передавать вместе с EXE, хотя notices также встроены в него.

14 зависимостей приложения зафиксированы в [requirements-runtime.snapshot.txt](requirements-runtime.snapshot.txt) и корневом requirements.txt. PyInstaller, hooks и вспомогательные инструменты — **зависимости сборки**, они не добавлены в runtime requirements. Полное окружение сборки, включая pip, зафиксировано в [build-environment.lock.txt](build-environment.lock.txt). На исходный датасет организатора новая лицензия не назначается; происхождение — [THIRD_PARTY](../docs/THIRD_PARTY.md).

## Повторить сборку из исходников

Только для разработчика: Windows x64, Python 3.12.10 и интернет для установки build-зависимостей. Выполнять PowerShell из корня репозитория с указанными runtime-исходниками. Окружение, cache, work/spec/dist создаются **в отдельной соседней папке**, venv в переносимый пакет не копируется. В `portable/licenses` должны находиться полные notices этой версии.

```powershell
$repoRoot = (Resolve-Path .).Path
$buildRoot = Join-Path (Split-Path $repoRoot -Parent) 'portable-build-repro'
$licensesRoot = Join-Path $repoRoot 'portable\licenses'
if (-not (Test-Path -LiteralPath $licensesRoot)) { throw 'Missing portable/licenses' }
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
py -3.12 -m venv "$buildRoot\.venv"
& "$buildRoot\.venv\Scripts\python.exe" -m pip install --no-cache-dir -r "$repoRoot\requirements.txt" -r "$repoRoot\portable\build-environment.lock.txt"
if ($LASTEXITCODE -ne 0) { throw 'Build dependencies failed' }
& "$buildRoot\.venv\Scripts\python.exe" -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Dependency check failed' }
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYINSTALLER_CONFIG_DIR = Join-Path $buildRoot 'pyinstaller-cache'
$packArgs = @(
  '-m', 'PyInstaller', '--noconfirm', '--onefile', '--console',
  '--name', 'ContractorPicker', '--collect-submodules', 'uvicorn',
  '--hidden-import', 'anyio._backends._asyncio', '--paths', $repoRoot,
  '--workpath', (Join-Path $buildRoot 'work'),
  '--specpath', (Join-Path $buildRoot 'spec'),
  '--distpath', (Join-Path $buildRoot 'dist')
)
foreach ($asset in @('index.html','styles.css','view.mjs','api.mjs','app.mjs','i18n.mjs','search-select.mjs','catalog-guide.json')) {
  $packArgs += @('--add-data', ((Join-Path $repoRoot "frontend\$asset") + ';frontend'))
}
$packArgs += @('--add-data', ((Join-Path $repoRoot 'data\contractors.csv') + ';data'))
$packArgs += @('--add-data', ($licensesRoot + ';licenses'))
$packArgs += (Join-Path $repoRoot 'scripts\jury_launcher.py')
& "$buildRoot\.venv\Scripts\python.exe" @packArgs
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
Get-FileHash -Algorithm SHA256 -LiteralPath "$buildRoot\dist\ContractorPicker.exe"
```

Команда воспроизводит состав и способ сборки; побайтовая идентичность повторного EXE не гарантируется. Новую сборку нужно отдельно проверить и записать её SHA. В выполненной сборке PyInstaller предупредил об отсутствующем optional `tzdata`; приложение использует явные даты и asyncio/h11, реальный EXE smoke прошёл. Список analysis warnings также содержит платформенные и необязательные импорты.

## Ограничения платформы

Пакет рассчитан на Windows x64; сборки для macOS, Linux и Windows ARM не предоставлены. EXE не подписан цифровой подписью. Не отключайте антивирус, SmartScreen или правила организации ради запуска; при блокировке используйте разрешённый способ из основного README. Сервер слушает только loopback, свободный порт выбирается без остановки чужих процессов. Для завершения закройте консоль или нажмите Ctrl+C.
