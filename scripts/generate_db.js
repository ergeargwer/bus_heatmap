import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_ID = process.env.TDX_CLIENT_ID || 'peter0910-760fc57f-fdee-41bf';
const CLIENT_SECRET = process.env.TDX_CLIENT_SECRET || 'c66d7de8-7b10-4a4c-a1f2-9967cdc60872';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getAccessToken() {
  console.log('正在取得 TDX 存取 Token...');
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  const res = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  if (!res.ok) {
    throw new Error(`Token 取得失敗: ${res.statusText}`);
  }
  const data = await res.json();
  return data.access_token;
}

function parseWKT(wkt) {
  if (!wkt) return [];
  const matches = wkt.match(/[-]?\d+\.?\d*\s+[-]?\d+\.?\d*/g);
  if (!matches) return [];
  return matches.map(pt => {
    const coords = pt.trim().split(/\s+/);
    return [parseFloat(coords[0]), parseFloat(coords[1])];
  });
}

async function main() {
  try {
    const token = await getAccessToken();
    await sleep(1500); // 避免過快請求
    const dbDir = path.resolve(__dirname, '../public/db');
    const routesDir = path.join(dbDir, 'routes');
    
    // Create folders
    fs.mkdirSync(routesDir, { recursive: true });

    // --- 1. Fetch all Taipei bus shapes ---
    console.log('正在從 TDX 抓取路線形狀幾何 (Shape)...');
    let skip = 0;
    const top = 1000;
    const allShapes = [];
    
    while (true) {
      console.log(`正在抓取 Shape... skip = ${skip}`);
      const res = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Bus/Shape/City/Taipei?$top=${top}&$skip=${skip}&$format=JSON`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        console.error(`Shape 抓取失敗: ${res.statusText}`);
        break;
      }
      const data = await res.json();
      if (!data || data.length === 0) break;
      allShapes.push(...data);
      if (data.length < top) break;
      skip += top;
      await sleep(1500); // 每次 API 請求間隔 1.5 秒
    }

    console.log(`總共抓取到 ${allShapes.length} 條路線 Shape。正在處理並寫入個別檔案...`);
    const routeMap = new Map(); // Store routeUID -> RouteInfo to check valid routes
    
    for (const shape of allShapes) {
      if (shape.RouteUID && shape.RouteName?.Zh_tw && shape.Geometry) {
        const pathCoords = parseWKT(shape.Geometry);
        if (pathCoords.length === 0) continue;

        const routeInfo = {
          id: shape.RouteUID,
          name: shape.RouteName.Zh_tw,
          path: pathCoords
        };
        
        routeMap.set(shape.RouteUID, { name: shape.RouteName.Zh_tw });
        
        // Write individual route shape to public/db/routes/{RouteUID}.json
        fs.writeFileSync(
          path.join(routesDir, `${shape.RouteUID}.json`),
          JSON.stringify(routeInfo, null, 2)
        );
      }
    }
    console.log('所有路線形狀檔案寫入完成！');

    // --- 2. Fetch all Taipei bus stations ---
    console.log('正在從 TDX 抓取站點與經過路線對照資料 (Station)...');
    skip = 0;
    const allStations = [];
    
    while (true) {
      console.log(`正在抓取 Station... skip = ${skip}`);
      const res = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Bus/Station/City/Taipei?$top=${top}&$skip=${skip}&$format=JSON`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        console.error(`Station 抓取失敗: ${res.statusText}`);
        if (res.status === 429) {
          console.log('遭遇 429 Rate Limit，稍候 5 秒後重試該請求...');
          await sleep(5000);
          continue; // 重試同一請求
        }
        break;
      }
      const data = await res.json();
      if (!data || data.length === 0) break;
      allStations.push(...data);
      if (data.length < top) break;
      skip += top;
      await sleep(1500); // 每次 API 請求間隔 1.5 秒
    }

    console.log(`總共抓取到 ${allStations.length} 個原始站位。正在依站名整合並對照路線...`);
    
    // Group stations by their name to avoid duplicates and simplify search
    const stationGroup = new Map();
    
    for (const st of allStations) {
      const name = st.StationName?.Zh_tw;
      if (!name || !st.StationPosition) continue;
      
      const lon = st.StationPosition.PositionLon;
      const lat = st.StationPosition.PositionLat;
      
      // Get all RouteUIDs passing through this station
      const routes = new Set();
      if (st.Stops && Array.isArray(st.Stops)) {
        for (const stop of st.Stops) {
          if (stop.RouteUID) {
            // Only add if we have shape geometry for this route
            if (routeMap.has(stop.RouteUID)) {
              routes.add(stop.RouteUID);
            }
          }
        }
      }

      if (routes.size === 0) continue; // Skip stations without valid routes

      if (stationGroup.has(name)) {
        const existing = stationGroup.get(name);
        // Union routes
        routes.forEach(r => existing.routes.add(r));
        // Accumulate coords to average later
        existing.coords.push([lon, lat]);
      } else {
        stationGroup.set(name, {
          name,
          routes,
          coords: [[lon, lat]],
          uid: st.StationUID
        });
      }
    }

    // Convert group map to final array and calculate average coordinates
    const finalStations = [];
    for (const [name, data] of stationGroup.entries()) {
      const sumLon = data.coords.reduce((sum, c) => sum + c[0], 0);
      const sumLat = data.coords.reduce((sum, c) => sum + c[1], 0);
      const avgLon = parseFloat((sumLon / data.coords.length).toFixed(6));
      const avgLat = parseFloat((sumLat / data.coords.length).toFixed(6));

      finalStations.push({
        uid: data.uid,
        name: name,
        lon: avgLon,
        lat: avgLat,
        routes: Array.from(data.routes)
      });
    }

    // Write stations.json
    fs.writeFileSync(
      path.join(dbDir, 'stations.json'),
      JSON.stringify(finalStations, null, 2)
    );
    
    console.log(`站點彙整完成！共彙整出 ${finalStations.length} 個獨特公車站點。`);
    console.log(`資料庫生成成功！儲存路徑為: ${dbDir}`);

  } catch (e) {
    console.error('資料庫生成失敗：', e);
  }
}

main();
