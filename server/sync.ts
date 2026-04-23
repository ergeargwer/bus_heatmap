import { pool } from './db.js';

const CLIENT_ID = 'peter0910-760fc57f-fdee-41bf';
const CLIENT_SECRET = 'c66d7de8-7b10-4a4c-a1f2-9967cdc60872';
const CITIES = ['Taipei', 'NewTaipei'];

const NEON_COLORS: [number, number, number][] = [
  [0, 243, 255],
  [0, 255, 102],
  [188, 19, 254],
  [255, 145, 0],
  [255, 0, 85]
];

export async function getTDXToken(): Promise<string> {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  const res = await fetch(
    'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    }
  );

  if (!res.ok) {
    throw new Error(`TDX token request failed: HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, string>;
  if (!data.access_token) {
    throw new Error('TDX did not return access_token');
  }
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

async function syncStations(token: string, city: string): Promise<number> {
  let skip = 0;
  const top = 1000;
  let total = 0;

  while (true) {
    const res = await fetch(
      `https://tdx.transportdata.tw/api/basic/v2/Bus/Station/City/${city}?$select=StationUID,StationName,StationPosition&$top=${top}&$skip=${skip}&$format=JSON`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      console.error(`[sync] syncStations HTTP ${res.status} for ${city} skip=${skip}`);
      break;
    }

    const data = await res.json() as Record<string, unknown>[];
    if (!data || data.length === 0) break;

    for (const s of data) {
      const pos = s.StationPosition as Record<string, number> | undefined;
      const name = (s.StationName as Record<string, string> | undefined)?.Zh_tw;
      if (!s.StationUID || !name || !pos) continue;

      await pool.query(
        `INSERT INTO stations (uid, name_zh, lon, lat, city)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (uid) DO UPDATE
           SET name_zh = EXCLUDED.name_zh,
               lon = EXCLUDED.lon,
               lat = EXCLUDED.lat`,
        [s.StationUID, name, pos.PositionLon, pos.PositionLat, city]
      );
    }

    total += data.length;
    skip += top;
    if (data.length < top) break;

    await new Promise(r => setTimeout(r, 300));
  }

  return total;
}

async function syncRoutes(token: string, city: string): Promise<number> {
  const res = await fetch(
    `https://tdx.transportdata.tw/api/basic/v2/Bus/Route/City/${city}?$select=RouteUID,RouteName&$format=JSON`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    console.error(`[sync] syncRoutes HTTP ${res.status} for ${city}`);
    return 0;
  }

  const data = await res.json() as Record<string, unknown>[];
  if (!data || data.length === 0) return 0;

  let count = 0;
  let colorIdx = 0;

  for (const route of data) {
    const name = (route.RouteName as Record<string, string> | undefined)?.Zh_tw;
    if (!route.RouteUID || !name) continue;

    await pool.query(
      `INSERT INTO routes (uid, name_zh, city)
       VALUES ($1, $2, $3)
       ON CONFLICT (uid) DO UPDATE
         SET name_zh = EXCLUDED.name_zh`,
      [route.RouteUID, name, city]
    );

    const shapeRes = await fetch(
      `https://tdx.transportdata.tw/api/basic/v2/Bus/Shape/City/${city}?$filter=RouteUID eq '${route.RouteUID}'&$format=JSON`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (shapeRes.ok) {
      const shapeData = await shapeRes.json() as Record<string, unknown>[];
      if (shapeData && shapeData.length > 0 && shapeData[0].Geometry) {
        const path = parseWKT(shapeData[0].Geometry as string);
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
    }

    count++;
    await new Promise(r => setTimeout(r, 200));
  }

  return count;
}

export async function runFullSync(): Promise<void> {
  console.log('[sync] starting full TDX data sync...');
  const token = await getTDXToken();
  let totalStations = 0;
  let totalRoutes = 0;

  try {
    for (const city of CITIES) {
      console.log(`[sync] syncing stations for ${city}...`);
      const s = await syncStations(token, city);
      totalStations += s;
      console.log(`[sync] ${city} stations done: ${s} records`);

      console.log(`[sync] syncing routes for ${city}...`);
      const r = await syncRoutes(token, city);
      totalRoutes += r;
      console.log(`[sync] ${city} routes done: ${r} records`);
    }

    await pool.query(
      `INSERT INTO sync_log (stations_count, routes_count, status) VALUES ($1, $2, 'success')`,
      [totalStations, totalRoutes]
    );
    console.log(`[sync] complete. stations: ${totalStations}, routes: ${totalRoutes}`);
  } catch (err) {
    await pool.query(
      `INSERT INTO sync_log (stations_count, routes_count, status) VALUES ($1, $2, 'error')`,
      [totalStations, totalRoutes]
    ).catch(() => {});
    console.error('[sync] sync failed:', err);
    throw err;
  }
}
