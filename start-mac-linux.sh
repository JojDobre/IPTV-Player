#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Chyba: nie je nainštalovaný Node.js. Stiahni ho z https://nodejs.org (verzia LTS)."; exit 1; }
[ -d node_modules ] || { echo "Inštalujem knižnice, prvýkrát to chvíľu trvá…"; npm install || exit 1; }
[ -f dist/index.html ] || { echo "Pripravujem aplikáciu…"; npm run build || exit 1; }
( sleep 1.5; (command -v open >/dev/null && open http://localhost:8080) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8080) ) >/dev/null 2>&1 &
exec node server/server.js
