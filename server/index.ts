import { createApp } from './app'
import { closeDatabase, openDatabase } from './db'
import { FACILITY } from './config'

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '127.0.0.1'
const db = openDatabase()
const app = createApp({ db })

const server = app.listen(port, host, () => {
  console.log(`[afribok] ${FACILITY.name} listening on http://${host}:${port}`)
  console.log('[afribok] clinical support: triage, scribe, paper-record OCR, outflow forecast')
})

function shutdown(signal: string) {
  console.log(`[afribok] ${signal} received, shutting down`)
  server.close(() => {
    closeDatabase(db)
    process.exit(0)
  })
  setTimeout(() => {
    closeDatabase(db)
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
