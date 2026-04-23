# NeoTransit (Bus Heatmap)

A high-tech bus route visualization app with an "Antigravity Theme" dark aesthetic, using Taiwan's TDX API for real-time bus tracking and route geometry visualization.

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite 5 with @vitejs/plugin-react-swc
- **Rendering**: Deck.gl v9 (WebGL) for bus routes and live positions
- **Map**: MapLibre GL + react-map-gl (Carto Dark Matter tiles)
- **Backend**: Node.js + Express (port 3001) with TypeScript via tsx
- **Database**: PostgreSQL (Replit built-in) — stations, routes, route_shapes, sync_log
- **Data**: TDX (Transport Data eXchange) API — Taiwan real-time bus data
- **Scheduler**: node-cron — weekly sync every Monday 03:00 Asia/Taipei
- **Icons**: Lucide React
- **Package Manager**: npm

## Project Structure

```
src/
  App.tsx       - Main app logic, Deck.gl layers, physics animations
  main.tsx      - Entry point
  tdxApi.ts     - TDX API (OAuth token, live buses via TDX; station/route calls via backend)
  mockData.ts   - Seed data for initial visualization
  index.css     - Global styles and neon theme
server/
  index.ts      - Express entry point, cron scheduler, auto-import on empty DB
  api.ts        - REST routes: /api/stations/suggest, /api/stations/nearby, /api/routes, /api/admin/*
  sync.ts       - TDX full-sync logic (stations + routes + shapes for Taipei + NewTaipei)
  db.ts         - pg Pool, initDB() schema creation
  tsconfig.json - Server-side TypeScript config (NodeNext modules)
index.html      - HTML entry point
vite.config.ts  - Vite config (port 5000, proxies: /api → localhost:3001, /tdx-* → TDX)
```

## API Endpoints (backend on port 3001)

| Endpoint | Description |
|---|---|
| `GET /api/stations/suggest?q=台北` | Autocomplete — fuzzy station name match |
| `GET /api/stations/nearby?lon=&lat=&radius=` | Nearby stations via haversine (radius in metres) |
| `GET /api/routes?station=台北火車站` | Routes through a station (TDX ETA + DB geometry) |
| `POST /api/admin/sync` | Trigger a manual full sync in background |
| `GET /api/admin/sync-log` | View last 10 sync records |

## Data Architecture

- Station suggestions, nearby stations, and route geometry are served from PostgreSQL (no direct TDX calls)
- Live bus positions (`getLiveBuses`) still call TDX directly via Vite proxy
- Weekly cron re-syncs all data Monday 03:00 Asia/Taipei
- On startup, if `stations` table is empty, a full import runs automatically

## Development

```bash
npm install
npm run dev:frontend   # Vite frontend on port 5000
npm run dev:backend    # Express backend on port 3001
npm run dev            # Both via concurrently
```

## Deployment

Configured as a static site deployment:
- Build: `npm run build`
- Public dir: `dist`
- Note: Static deployment does not include the backend server.
