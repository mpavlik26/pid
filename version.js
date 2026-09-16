// Jediný zdroj pravdy pro verzi appky (US-9). Používá se jak pro zobrazení
// verze v UI (app.js), tak pro cache busting service workera (sw.js přes
// importScripts). Bumpni při každé změně souboru ze SHELL_FILES (viz CLAUDE.md).
const APP_VERSION = 'v19';
