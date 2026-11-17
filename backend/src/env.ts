import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Imported first by index.ts, so the variables are set before any other module reads them.
// Local runs read backend/.env; in Docker they come from the container instead.
// Variables already set in the environment win over the file.
const envFile = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)
