// Quick round-trip test for the macos-vision-ocr sidecar. Spawns it
// directly (bypasses Electron-side bridge), feeds a length-prefixed PNG,
// reads NDJSON. Intended to verify the sidecar protocol end-to-end on
// any image, not to verify VN OCR accuracy specifically.
//
// Run: npx tsx scripts/verify-ocr-sidecar.ts <path-to-png>

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const sidecar = resolve(projectRoot, 'resources', 'bin', 'macos-vision-ocr')

if (!existsSync(sidecar)) {
  console.error(`sidecar not built — run: npm run build:sidecar:mac`)
  process.exit(1)
}

const pngArg = process.argv[2]
if (!pngArg) {
  console.error('usage: tsx scripts/verify-ocr-sidecar.ts <path-to-png>')
  process.exit(1)
}

const pngPath = resolve(pngArg)
if (!existsSync(pngPath)) {
  console.error(`PNG not found: ${pngPath}`)
  process.exit(1)
}

const png = readFileSync(pngPath)
console.log(`feeding ${png.length} bytes to sidecar`)

const proc = spawn(sidecar, [], { stdio: ['pipe', 'pipe', 'pipe'] })
proc.stderr.on('data', (c: Buffer) => process.stderr.write('[stderr] ' + c.toString()))

let buf = ''
proc.stdout.setEncoding('utf8')
proc.stdout.on('data', (chunk: string) => {
  buf += chunk
  const newline = buf.indexOf('\n')
  if (newline >= 0) {
    const line = buf.slice(0, newline)
    console.log('result:', line)
    proc.stdin.end()
  }
})

const lengthPrefix = Buffer.alloc(4)
lengthPrefix.writeUInt32BE(png.length, 0)
proc.stdin.write(lengthPrefix)
proc.stdin.write(png)
