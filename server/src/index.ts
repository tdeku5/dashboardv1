import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fredRouter } from './routes/fred'

dotenv.config({ path: '../.env' })

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
app.use(express.json())

app.use('/api/fred', fredRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
