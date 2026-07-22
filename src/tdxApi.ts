export function getTDXCredentials() {
  const customId = localStorage.getItem('tdx_client_id');
  const customSecret = localStorage.getItem('tdx_client_secret');
  return {
    clientId: customId || 'peter0910-760fc57f-fdee-41bf',
    clientSecret: customSecret || 'c66d7de8-7b10-4a4c-a1f2-9967cdc60872',
    isCustom: !!(customId && customSecret)
  };
}

let accessToken = '';

export function clearTDXTokenCache() {
  accessToken = '';
}

export async function getTDXToken() {
  if (accessToken) return accessToken;
  
  const { clientId, clientSecret } = getTDXCredentials();
  
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);

  const res = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  if (!res.ok) {
    throw new Error(`TDX Token 取得失敗 (HTTP ${res.status}): ${res.statusText}`);
  }
  
  const data = await res.json();
  accessToken = data.access_token;
  return accessToken;
}

interface StaticStation {
  uid: string;
  name: string;
  lon: number;
  lat: number;
  routes: string[];
}

let cachedStations: StaticStation[] | null = null;

async function loadStaticStations(): Promise<StaticStation[]> {
  if (cachedStations) return cachedStations;
  try {
    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/db/stations.json`);
    if (!res.ok) throw new Error(`無法載入靜態站點資料庫: ${res.statusText}`);
    cachedStations = await res.json();
    return cachedStations || [];
  } catch (err) {
    console.error('載入靜態站點失敗，改用空陣列。', err);
    return [];
  }
}

function getDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371e3; // 地球半徑 (公尺)
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getStationCoordinate(stationName: string, city: string = 'Taipei') {
  const stations = await loadStaticStations();
  const found = stations.find(s => s.name === stationName || s.name.includes(stationName));
  if (found) {
    return [found.lon, found.lat];
  }
  return null;
}

export async function searchBusRoutesByStation(stationName: string, city: string = 'Taipei') {
  const stations = await loadStaticStations();
  const found = stations.find(s => s.name === stationName || s.name.includes(stationName));
  if (!found || !found.routes || found.routes.length === 0) return [];

  const routes = [];
  const neonColors = [
    { color: [0, 243, 255] as [number, number, number], str: 'var(--neon-blue)' },
    { color: [0, 255, 102] as [number, number, number], str: 'var(--neon-green)' },
    { color: [188, 19, 254] as [number, number, number], str: 'var(--neon-violet)' },
    { color: [255, 145, 0] as [number, number, number], str: 'var(--neon-orange)' },
    { color: [255, 0, 85] as [number, number, number], str: '#ff0055' }
  ];

  let colorIdx = 0;
  // 限制一次最多只下載 10 條路線 Shape 幾何
  const routeUids = found.routes.slice(0, 10);

  for (const uid of routeUids) {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/db/routes/${uid}.json`);
      if (!res.ok) continue;
      const data = await res.json();
      
      const c = neonColors[colorIdx % neonColors.length];
      routes.push({
        id: uid,
        name: data.name,
        color: c.color,
        neonColorStr: c.str,
        path: data.path
      });
      colorIdx++;
    } catch (err) {
      console.error(`載入路線 ${uid} 幾何失敗`, err);
    }
  }

  return routes;
}

export interface LiveBus {
  plateNumb: string;
  routeUid: string;
  routeName: string;
  position: [number, number];
  speed: number;
  direction: number;
  busStatus: number;
}

export async function getLiveBuses(routeUids: string[], city: string = 'Taipei'): Promise<LiveBus[]> {
  if (!routeUids || routeUids.length === 0) return [];
  const token = await getTDXToken();
  
  const filterString = routeUids.map(uid => `RouteUID eq '${uid}'`).join(' or ');
  
  try {
    const res = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Bus/RealTimeNearStop/City/${city}?$filter=${encodeURIComponent(filterString)}&$format=JSON`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    const buses: LiveBus[] = [];
    const seen = new Set<string>();
    
    for (const item of (data || [])) {
      if (item.BusPosition && item.PlateNumb && !seen.has(item.PlateNumb)) {
        seen.add(item.PlateNumb);
        buses.push({
          plateNumb: item.PlateNumb,
          routeUid: item.RouteUID,
          routeName: item.RouteName?.Zh_tw || '',
          position: [item.BusPosition.PositionLon, item.BusPosition.PositionLat],
          speed: item.Speed || 0,
          direction: item.Direction || 0,
          busStatus: item.BusStatus || 0
        });
      }
    }
    return buses;
  } catch (error) {
    console.error("Failed to fetch live buses", error);
    return [];
  }
}

export interface NearbyStation {
  uid: string;
  name: string;
  lon: number;
  lat: number;
}

export async function getNearbyStations(lon: number, lat: number, radiusMeters: number = 100): Promise<NearbyStation[]> {
  const stations = await loadStaticStations();
  return stations
    .map(s => ({
      uid: s.uid,
      name: s.name,
      lon: s.lon,
      lat: s.lat,
      dist: getDistance(lon, lat, s.lon, s.lat)
    }))
    .filter(s => s.dist <= radiusMeters)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 10)
    .map(s => ({
      uid: s.uid,
      name: s.name,
      lon: s.lon,
      lat: s.lat
    }));
}

export async function getStationSuggestions(keyword: string): Promise<NearbyStation[]> {
  if (!keyword) return [];
  const stations = await loadStaticStations();
  const filtered = stations
    .filter(s => s.name.toLowerCase().includes(keyword.toLowerCase()))
    .slice(0, 10);
  return filtered.map(s => ({
    uid: s.uid,
    name: s.name,
    lon: s.lon,
    lat: s.lat
  }));
}
