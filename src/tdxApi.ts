const CLIENT_ID = 'peter0910-760fc57f-fdee-41bf';
const CLIENT_SECRET = 'c66d7de8-7b10-4a4c-a1f2-9967cdc60872';

let accessToken = '';

export async function getTDXToken() {
  if (accessToken) return accessToken;
  
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
  
  const data = await res.json();
  accessToken = data.access_token;
  return accessToken;
}

function parseWKT(wkt: string): [number, number][] {
  const matches = wkt.match(/[-]?\d+\.?\d*\s+[-]?\d+\.?\d*/g);
  if (!matches) return [];
  return matches.map(pt => {
    const coords = pt.trim().split(/\s+/);
    return [parseFloat(coords[0]), parseFloat(coords[1])];
  });
}

export async function getStationCoordinate(stationName: string, city: string = 'Taipei') {
  const token = await getTDXToken();
  const res = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Bus/Station/City/${city}?$filter=contains(StationName/Zh_tw,'${stationName}')&$top=1&$format=JSON`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  if (data && data.length > 0) {
    return [data[0].StationPosition.PositionLon, data[0].StationPosition.PositionLat];
  }
  return null;
}

export async function searchBusRoutesByStation(stationName: string, city: string = 'Taipei') {
  const token = await getTDXToken();
  
  const etaRes = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City/${city}?$filter=contains(StopName/Zh_tw,'${stationName}')&$select=RouteName,RouteUID&$format=JSON`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const etaData = await etaRes.json();
  
  const uniqueRoutes = new Map<string, string>();
  for (const item of (etaData || [])) {
    if (item.RouteUID && item.RouteName?.Zh_tw) {
      uniqueRoutes.set(item.RouteUID, item.RouteName.Zh_tw);
    }
  }

  const routes = [];
  const neonColors = [
    { color: [0, 243, 255] as [number, number, number], str: 'var(--neon-blue)' },
    { color: [0, 255, 102] as [number, number, number], str: 'var(--neon-green)' },
    { color: [188, 19, 254] as [number, number, number], str: 'var(--neon-violet)' },
    { color: [255, 145, 0] as [number, number, number], str: 'var(--neon-orange)' },
    { color: [255, 0, 85] as [number, number, number], str: '#ff0055' }
  ];

  let colorIdx = 0;
  for (const [uid, name] of uniqueRoutes.entries()) {
    if (routes.length >= 10) break; // 防止載入時間過長

    const shapeRes = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Bus/Shape/City/${city}?$filter=RouteUID eq '${uid}'&$format=JSON`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const shapeData = await shapeRes.json();
    
    if (shapeData && shapeData.length > 0 && shapeData[0].Geometry) {
      const path = parseWKT(shapeData[0].Geometry);
      const c = neonColors[colorIdx % neonColors.length];
      routes.push({
        id: uid,
        name: name,
        color: c.color,
        neonColorStr: c.str,
        path: path
      });
      colorIdx++;
    }
  }

  return routes;
}
