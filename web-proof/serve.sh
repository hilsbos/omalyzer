#!/usr/bin/env bash
# Serve web-proof/ over http://localhost (a secure context for mic + modules).
# The audio path uses postMessage (not SharedArrayBuffer), so NO COOP/COEP
# headers and NO HTTPS cert are needed — http://localhost counts as secure.
cd "$(dirname "$0")"
python3 -m http.server 8080
# then open http://localhost:8080/
