# smc backend

The API behind the frontend: PIN unlock, settings, and the RankUOG proxy that keeps collection keys off the browser. It has no runtime dependencies; Node runs the TypeScript directly.

Copy `.env.example` to `.env` and set `APP_PIN`.

## Run with Node (24+)

```sh
npm install      # only TypeScript, for `npm run typecheck`
npm run dev      # restarts on changes
npm start
```

## Run with Docker

```sh
docker compose up -d --build
```

Both ways listen on http://localhost:3001 and use the same settings file, `../data/settings.json`. Docker mounts that folder at `/data`.

On a Linux host, the container's `node` user (uid 1000) needs write access to `../data`.

## Frontend

The Vite dev server (`npm run dev` in `../frontend`) proxies `/api` to `http://localhost:3001`. To use another address, set `API_URL` in `frontend/.env.local`.
