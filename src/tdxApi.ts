const CLIENT_ID = 'peter0910-760fc57f-fdee-41bf';
const CLIENT_SECRET = 'c66d7de8-7b10-4a4c-a1f2-9967cdc60872';

let accessToken = '';

export async function getTDXToken() {
  if (accessToken) return accessToken;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  const res = await fetch('/tdx-auth/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    throw new Error(`TDX 授權失敗 (HTTP ${res.status})`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('TDX 未回傳 access_token');
  }
  accessToken = data.access_token;
  return accessToken;
}

export interface NearbyStation {
  uid: string;
  name: string;
  lon: number;
  lat: number;
  distance?: number;
}

export async function getStationSuggestions(keyword: string): Promise<NearbyStation[]> {
  if (!keyword) return [];
  try {
    const res = await fetch(`/api/stations/suggest?q=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function getNearbyStations(lon: number, lat: number, radius = 100): Promise<NearbyStation[]> {
  try {
    const res = await fetch(`/api/stations/nearby?lon=${lon}&lat=${lat}&radius=${radius}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function searchBusRoutesByStation(stationName: string): Promise<{ routes: RouteData[]; center: [number, number] | null }> {
  const res = await fetch(`/api/routes?station=${encodeURIComponent(stationName)}`);
  if (!res.ok) throw new Error(`後端查詢失敗 (HTTP ${res.status})`);
  return res.json();
}

export interface RouteData {
  id: string;
  name: string;
  color: [number, number, number];
  neonColorStr: string;
  path: [number, number][];
}

export interface ApiTestResult {
  label: string;
  ok: boolean;
  detail: string;
}

export async function testApiConnection(): Promise<ApiTestResult[]> {
  const results: ApiTestResult[] = [];

  let token = '';
  try {
    accessToken = '';
    token = await getTDXToken();
    results.push({ label: 'TDX 授權 Token', ok: !!token, detail: token ? '取得成功' : '無回傳 Token' });
  } catch (e: unknown) {
    results.push({ label: 'TDX 授權 Token', ok: false, detail: (e as Error)?.message || '連線失敗' });
    return results;
  }

  try {
    const res = await fetch(
      `/tdx-api/api/basic/v2/Bus/Station/City/Taipei?$filter=contains(StationName/Zh_tw,'%E5%8F%B0%E5%8C%97')&$top=1&$select=StationUID,StationName&$format=JSON`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const ok = Array.isArray(data) && data.length > 0;
    results.push({ label: '站位查詢', ok, detail: ok ? `回傳站名：${data[0].StationName?.Zh_tw}` : '無資料' });
  } catch (e: unknown) {
    results.push({ label: '站位查詢', ok: false, detail: (e as Error)?.message || '查詢失敗' });
  }

  try {
    const res = await fetch(
      `/tdx-api/api/basic/v2/Bus/Shape/City/Taipei?$top=1&$select=RouteUID,RouteName&$format=JSON`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const ok = Array.isArray(data) && data.length > 0;
    results.push({ label: '路線幾何資料', ok, detail: ok ? `回傳路線：${data[0].RouteName?.Zh_tw}` : '無資料' });
  } catch (e: unknown) {
    results.push({ label: '路線幾何資料', ok: false, detail: (e as Error)?.message || '查詢失敗' });
  }

  return results;
}

