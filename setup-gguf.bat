@echo off
setlocal
title Umbras Pass - Automated GGUF Setup
echo ============================================================
echo   Umbras Pass - Automated Local AI (.gguf) Setup
echo ============================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  if exist "package.json" (
    echo Running automated Node.js setup ^(npm dependencies + .gguf model^)...
    echo.
    node scripts/setup-umbras-pass.mjs %*
    if %ERRORLEVEL% NEQ 0 (
      echo.
      echo Setup encountered an error. Please check your internet connection and try again.
      pause
      exit /b 1
    )
    echo.
    echo All done! You can now start Umbras Pass with: npm run dev
    pause
    exit /b 0
  )
)

echo Node.js repo not detected - downloading standalone .gguf model directly into .\models\ ...
echo.
if not exist "models" mkdir "models"
set "TARGET_FILE=models\Qwen3-4B-Q4_K_M.gguf"
set "MODEL_URL=https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true"

if exist "%TARGET_FILE%" (
  echo Found existing model at %TARGET_FILE% - no download needed!
) else (
  echo Downloading Qwen3-4B-Q4_K_M.gguf from Hugging Face (~2.5 GB^)...
  curl.exe -L --progress-bar -o "%TARGET_FILE%.partial" "%MODEL_URL%"
  if %ERRORLEVEL% NEQ 0 (
    if exist "%TARGET_FILE%.partial" del "%TARGET_FILE%.partial"
    echo.
    echo Download failed. Please check your internet connection and retry.
    pause
    exit /b 1
  )
  move /Y "%TARGET_FILE%.partial" "%TARGET_FILE%" >nul
  echo.
  echo Saved %TARGET_FILE% successfully!
)

echo.
echo Setup complete! Launch Umbras Pass and your local .gguf model will be auto-detected.
pause
endlocal
