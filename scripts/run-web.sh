#!/usr/bin/env bash

set -euo pipefail
cd "`dirname \"$0\"`/.."

export POSTGRES_HOST=127.0.0.1:30432
export POSTGRES_USER=aether
export POSTGRES_PASSWORD=aetherlight
export POSTGRES_DB=aether
export HMAC_SECRET="96i54dKLm+Z9NVPwdNEyEbO9ohyveG0p660L75aPYAI="


cargo run -p aether --release -- web --hostname aetherlight.lan ./web/out