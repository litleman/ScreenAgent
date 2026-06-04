#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const entry = path.resolve(__dirname, '..', 'scripts', 'configure.mjs')
await import(entry)
