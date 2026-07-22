# Replit AI 修改指令：新增後端 API + PostgreSQL 資料庫 + 每週自動排程

## 專案現況

這是一個 Vite + React + TypeScript 純前端專案，目前直接從瀏覽器呼叫 TDX API 取得台北公車資料。

本次目標：
1. 新增 Node.js + Express 後端
2. 建立 PostgreSQL 資料庫，儲存台北市＋新北市的站位、路線、路線幾何資料
3. 撰寫一次性匯入腳本，從 TDX 拉取全量資料寫入 DB
4. 設定 node-cron 每週一凌晨 03:00 自動重新同步
5. 前端 Autocomplete、附近站位、路線查詢全部改打自己的後端 API，不再直接呼叫 TDX

---

## 步驟一：安裝套件

在 Replit Shell 執行：

```bash
npm install express cors pg node-cron node-fetch@2
npm install --save-dev @types/express @types/cors @types/pg @types/node-cron
```

---

## 步驟二：建立資料庫 Schema

新增檔案 `server/db.ts`：

```ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stations (
      uid TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      city TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stations_name ON stations USING gin(name_zh gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_stations_location ON stations USING gist(
      ll_to_earth(lat, lon)
    );

    CREATE TABLE IF NOT EXISTS routes (
      uid TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      city TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_shapes (
      uid TEXT PRIMARY KEY REFERENCES routes(uid) ON DELETE CASCADE,
      geometry JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      synced_at TIMESTAMPTZ DEFAULT NOW(),
      stations_count INT,
      routes_count INT,
      status TEXT
    );
  `);

  // pg_trgm 與 earthdistance 為 PostgreSQL 內建 extension，需啟用
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS cube;
    CREATE EXTENSION IF NOT EXISTS earthdistance;
  `).catch(() => {
    // 若 Replit PostgreSQL 不支援 earthdistance，改用經緯度距離公式（見 getNearbyStations）
    console.warn('earthdistance extension not available, fallback to haversine query');
  });
}
```

---

## 步驟三：TDX 同步腳本

新增檔案 `server/sync.ts`：

```ts
import { pool } from './db';

const CLIENT_ID = 'peter0910-760fc57f-fdee-41bf';
const CLIENT_SECRET = 'c66d7de8-7b10-4a4c-a1f2-9967cdc60872';
const CITIES = ['Taipei', 'NewTaipei'];

// 色票循環（對應前端霓虹配色）
const NEON_COLORS = [
  [0, 243, 255],
  [0, 255, 102],
  [188, 19, 254],
  [255, 145, 0],
  [255, 0, 85]
];

async function getTDXToken(): Promise<string> {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  const res = await fetch(
    'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
  );
  const data = await res.json() as any;
  return data.access_token;
}

function parseWKT(wkt: string): [number, number][] {
  const matches = wkt.match(/[-]?\d+\.?\d*\s+[-]?\d+\.?\d*/g);
  if (!matches) return [];
  return matches.map(pt => {
    const parts = pt.trim().split(/\s+/);
    return [parseFloat(parts[0]), parseFloat(parts[1])];
  });
}

async function syncStations(token: string, city: string) {
  let skip = 0;
  const top = 1000;
  let total = 0;

  while (true) {
    const res = await fetch(
      `https://tdx.transportdata.tw/api/basic/v2/Bus/Station/City/${city}?$select=StationUID,StationName,StationPosition&$top=${top}&$skip=${skip}&$format=JSON`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any[];
    if (!data || data.length === 0) break;

    for (const s of data) {
      if (!s.StationUID || !s.StationName?.Zh_tw || !s.StationPosition) continue;
      await pool.query(
        `INSERT INTO stations (uid, name_zh, lon, lat, city)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (uid) DO UPDATE
           SET name_zh = EXCLUDED.name_zh,
               lon = EXCLUDED.lon,
               lat = EXCLUDED.lat`,
        [s.StationUID, s.StationName.Zh_tw, s.StationPosition.PositionLon, s.StationPosition.PositionLat, city]
      );
    }

    total += data.length;
    skip += top;
    if (data.length < top) break;

    // TDX 速率保護：每批次暫停 300ms
    await new Promise(r => setTimeout(r, 300));
  }

  return total;
}

async function syncRoutes(token: string, city: string) {
  // 先取所有路線清單
  const res = await fetch(
    `https://tdx.transportdata.tw/api/basic/v2/Bus/Route/City/${city}?$select=RouteUID,RouteName&$format=JSON`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json() as any[];
  if (!data || data.length === 0) return 0;

  let count = 0;
  let colorIdx = 0;

  for (const route of data) {
    if (!route.RouteUID || !route.RouteName?.Zh_tw) continue;

    // 寫入 routes 表
    await pool.query(
      `INSERT INTO routes (uid, name_zh, city)
       VALUES ($1, $2, $3)
       ON CONFLICT (uid) DO UPDATE
         SET name_zh = EXCLUDED.name_zh`,
      [route.RouteUID, route.RouteName.Zh_tw, city]
    );

    // 取路線幾何
    const shapeRes = await fetch(
      `https://tdx.transportdata.tw/api/basic/v2/Bus/Shape/City/${city}?$filter=RouteUID eq '${route.RouteUID}'&$format=JSON`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const shapeData = await shapeRes.json() as any[];

    if (shapeData && shapeData.length > 0 && shapeData[0].Geometry) {
      const path = parseWKT(shapeData[0].Geometry);
      const color = NEON_COLORS[colorIdx % NEON_COLORS.length];
      colorIdx++;

      await pool.query(
        `INSERT INTO route_shapes (uid, geometry)
         VALUES ($1, $2)
         ON CONFLICT (uid) DO UPDATE
           SET geometry = EXCLUDED.geometry`,
        [route.RouteUID, JSON.stringify({ path, color })]
      );
    }

    count++;
    // TDX 速率保護
    await new Promise(r => setTimeout(r, 200));
  }

  return count;
}

export async function runFullSync() {
  console.log('[sync] 開始全量同步 TDX 資料...');
  const token = await getTDXToken();
  let totalStations = 0;
  let totalRoutes = 0;

  try {
    for (const city of CITIES) {
      console.log(`[sync] 同步 ${city} 站位...`);
      const s = await syncStations(token, city);
      totalStations += s;
      console.log(`[sync] ${city} 站位完成：${s} 筆`);

      console.log(`[sync] 同步 ${city} 路線...`);
      const r = await syncRoutes(token, city);
      totalRoutes += r;
      console.log(`[sync] ${city} 路線完成：${r} 筆`);
    }

    await pool.query(
      `INSERT INTO sync_log (stations_count, routes_count, status) VALUES ($1, $2, 'success')`,
      [totalStations, totalRoutes]
    );
    console.log(`[sync] 完成。站位 ${totalStations} 筆，路線 ${totalRoutes} 筆`);
  } catch (err) {
    await pool.query(
      `INSERT INTO sync_log (stations_count, routes_count, status) VALUES ($1, $2, 'error')`,
      [totalStations, totalRoutes]
    );
    console.error('[sync] 同步失敗：', err);
    throw err;
  }
}
```

---

## 步驟四：後端 API 路由

新增檔案 `server/api.ts`：

```ts
import { Router } from 'express';
import { pool } from './db';

const router = Router();

// GET /api/stations/suggest?q=台北火車
// Autocomplete：模糊比對站名，回傳前 10 筆
router.get('/stations/suggest', async (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q || q.length < 1) return res.json([]);

  try {
    const result = await pool.query(
      `SELECT uid, name_zh, lon, lat, city
       FROM stations
       WHERE name_zh LIKE $1
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json(result.rows.map(r => ({
      uid: r.uid,
      name: r.name_zh,
      lon: parseFloat(r.lon),
      lat: parseFloat(r.lat)
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/stations/nearby?lon=121.51&lat=25.04&radius=100
// 附近站位：haversine 公式，radius 單位為公尺
router.get('/stations/nearby', async (req, res) => {
  const lon = parseFloat(req.query.lon as string);
  const lat = parseFloat(req.query.lat as string);
  const radius = parseFloat(req.query.radius as string) || 100;

  if (isNaN(lon) || isNaN(lat)) return res.status(400).json({ error: 'invalid coordinates' });

  try {
    // 使用 haversine 公式計算距離（單位：公尺），不依賴 earthdistance extension
    const result = await pool.query(
      `SELECT uid, name_zh, lon, lat,
         (6371000 * acos(
           cos(radians($2)) * cos(radians(lat)) *
           cos(radians(lon) - radians($1)) +
           sin(radians($2)) * sin(radians(lat))
         )) AS distance
       FROM stations
       WHERE
         lat BETWEEN $2 - ($3 / 111000.0) AND $2 + ($3 / 111000.0)
         AND lon BETWEEN $1 - ($3 / (111000.0 * cos(radians($2)))) AND $1 + ($3 / (111000.0 * cos(radians($2))))
       HAVING (6371000 * acos(
           cos(radians($2)) * cos(radians(lat)) *
           cos(radians(lon) - radians($1)) +
           sin(radians($2)) * sin(radians(lat))
         )) <= $3
       ORDER BY distance ASC
       LIMIT 20`,
      [lon, lat, radius]
    );
    res.json(result.rows.map(r => ({
      uid: r.uid,
      name: r.name_zh,
      lon: parseFloat(r.lon),
      lat: parseFloat(r.lat),
      distance: Math.round(r.distance)
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/routes?station=台北火車站
// 查詢經過該站名的所有路線（含幾何資料）
router.get('/routes', async (req, res) => {
  const station = (req.query.station as string) || '';
  if (!station) return res.status(400).json({ error: 'station required' });

  try {
    // 先找出符合站名的 station uid
    const stationsRes = await pool.query(
      `SELECT uid, lon, lat FROM stations WHERE name_zh LIKE $1 LIMIT 5`,
      [`%${station}%`]
    );
    if (stationsRes.rows.length === 0) return res.json({ routes: [], center: null });

    const centerStation = stationsRes.rows[0];

    // 透過 TDX ETA API 查詢經過該站的路線（此部分仍需即時查詢，因為 ETA 是動態資料）
    // 但路線幾何從 DB 取得
    const { getTDXToken } = await import('./sync');
    const token = await getTDXToken();

    const etaRes = await fetch(
      `https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City/Taipei?$filter=contains(StopName/Zh_tw,'${encodeURIComponent(station)}')&$select=RouteName,RouteUID&$format=JSON`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const etaData = await etaRes.json() as any[];

    const uniqueRoutes = new Map<string, string>();
    for (const item of (etaData || [])) {
      if (item.RouteUID && item.RouteName?.Zh_tw) {
        uniqueRoutes.set(item.RouteUID, item.RouteName.Zh_tw);
      }
    }

    const NEON_COLORS_STR = [
      { color: [0, 243, 255], str: 'var(--neon-blue)' },
      { color: [0, 255, 102], str: 'var(--neon-green)' },
      { color: [188, 19, 254], str: 'var(--neon-violet)' },
      { color: [255, 145, 0], str: 'var(--neon-orange)' },
      { color: [255, 0, 85], str: '#ff0055' }
    ];

    const routes = [];
    let colorIdx = 0;

    for (const [uid, name] of uniqueRoutes.entries()) {
      if (routes.length >= 10) break;

      // 從 DB 取幾何
      const shapeRes = await pool.query(
        `SELECT geometry FROM route_shapes WHERE uid = $1`,
        [uid]
      );

      if (shapeRes.rows.length > 0) {
        const geo = shapeRes.rows[0].geometry;
        const c = NEON_COLORS_STR[colorIdx % NEON_COLORS_STR.length];
        routes.push({
          id: uid,
          name,
          color: c.color,
          neonColorStr: c.str,
          path: geo.path
        });
        colorIdx++;
      }
    }

    res.json({
      routes,
      center: [parseFloat(centerStation.lon), parseFloat(centerStation.lat)]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// POST /api/admin/sync
// 手動觸發同步（僅內部使用）
router.post('/admin/sync', async (_req, res) => {
  const { runFullSync } = await import('./sync');
  res.json({ message: '同步已在背景啟動' });
  runFullSync().catch(console.error);
});

// GET /api/admin/sync-log
// 查看最近同步紀錄
router.get('/admin/sync-log', async (_req, res) => {
  const result = await pool.query(
    `SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT 10`
  );
  res.json(result.rows);
});

export default router;
```

---

## 步驟五：後端進入點 + 排程器

新增檔案 `server/index.ts`：

```ts
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { initDB } from './db';
import api from './api';
import { runFullSync } from './sync';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api', api);

// 每週一凌晨 03:00 自動同步
cron.schedule('0 3 * * 1', () => {
  console.log('[cron] 每週自動同步啟動');
  runFullSync().catch(console.error);
}, {
  timezone: 'Asia/Taipei'
});

async function main() {
  await initDB();
  console.log('[db] 資料表初始化完成');

  // 若 stations 表是空的，自動執行第一次全量匯入
  const { pool } = await import('./db');
  const count = await pool.query('SELECT COUNT(*) FROM stations');
  if (parseInt(count.rows[0].count) === 0) {
    console.log('[db] 偵測到空資料庫，自動執行初始匯入（預計需 10~20 分鐘）');
    runFullSync().catch(console.error);
  }

  app.listen(PORT, () => {
    console.log(`[server] 後端啟動於 port ${PORT}`);
  });
}

main();
```

---

## 步驟六：修改 `vite.config.ts`（前端 proxy）

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
```

---

## 步驟七：修改 `src/tdxApi.ts`（改打後端 API）

將現有 `getStationCoordinate`、`searchBusRoutesByStation` 函式全部替換為打後端的版本：

```ts
// 保留 LiveBus 相關介面與 getLiveBuses 不變（即時資料仍打 TDX）

export interface NearbyStation {
  uid: string;
  name: string;
  lon: number;
  lat: number;
  distance?: number;
}

export async function getStationSuggestions(keyword: string): Promise<NearbyStation[]> {
  if (!keyword) return [];
  const res = await fetch(`/api/stations/suggest?q=${encodeURIComponent(keyword)}`);
  return res.json();
}

export async function getNearbyStations(lon: number, lat: number, radius = 100): Promise<NearbyStation[]> {
  const res = await fetch(`/api/stations/nearby?lon=${lon}&lat=${lat}&radius=${radius}`);
  return res.json();
}

export async function searchBusRoutesByStationFromDB(stationName: string) {
  const res = await fetch(`/api/routes?station=${encodeURIComponent(stationName)}`);
  const data = await res.json();
  return data as { routes: any[]; center: [number, number] | null };
}
```

---

## 步驟八：修改 `package.json` 的啟動指令

```json
{
  "scripts": {
    "dev:frontend": "vite",
    "dev:backend": "npx ts-node-esm server/index.ts",
    "dev": "concurrently \"npm run dev:frontend\" \"npm run dev:backend\"",
    "build": "vite build"
  }
}
```

同時安裝：

```bash
npm install concurrently ts-node
```

---

## 步驟九：Replit `.replit` 設定（若存在）

若專案根目錄有 `.replit` 設定檔，將 run 指令改為：

```
run = "npm run dev"
```

---

## 環境變數設定

在 Replit 的 Secrets（環境變數）面板新增：

```
DATABASE_URL = <Replit PostgreSQL 連線字串>
```

Replit PostgreSQL 連線字串可在 Replit 平台的 Database 分頁取得。

---

## 注意事項

- 所有程式碼禁止使用 emoji
- 初次啟動時，後端會自動偵測空資料庫並觸發全量匯入，台北＋新北站位＋路線幾何約需 **10～20 分鐘**（受 TDX API 速率限制）
- 同步期間 app 仍可正常使用（DB 寫入為 upsert，不影響讀取）
- `getLiveBuses` 維持直接打 TDX（即時資料，不適合快取）
- `getTDXToken` 在 `sync.ts` 中需 export，供 `api.ts` 的路線查詢使用
- 若 Replit PostgreSQL 不支援 `pg_trgm` extension，`LIKE` 查詢仍可正常運作，只是 gin index 不會生效（資料量不大，不影響效能）
