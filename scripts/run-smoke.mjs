import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Launches the built app with EQUIP_SMOKE=1. Kept as a script rather than an
// inline env assignment so `npm run smoke` behaves the same on Windows and Unix.
// Passing `--live` also runs the networked SoundCloud checks (search, stream,
// download) — they are skipped otherwise so the default smoke stays offline.
const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let electronBinary
try {
  electronBinary = require('electron')
} catch (error) {
  console.error('Could not resolve the Electron binary. Run `npm install` first.')
  console.error(error.message)
  process.exit(1)
}

const live = process.argv.includes('--live')

const result = spawnSync(electronBinary, [root], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EQUIP_SMOKE: '1',
    ...(live ? { EQUIP_SC_LIVE: '1' } : {})
  }
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)