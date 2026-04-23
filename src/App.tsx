import React, { useState, useEffect, useRef } from 'react';
import Map from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Search, Loader2, LocateFixed, FlaskConical, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { mockRoutes, centerStation as mockCenter } from './mockData';
import {
  searchBusRoutesByStation,
  NearbyStation, getNearbyStations, getStationSuggestions,
  testApiConnection, ApiTestResult
} from './tdxApi';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function getClosestPointIdx(path: number[][], center: number[]) {
  if (!path || path.length === 0) return 0;
  let minIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const dx = path[i][0] - center[0];
    const dy = path[i][1] - center[1];
    const d = dx * dx + dy * dy;
    if (d < minDist) { minDist = d; minIdx = i; }
  }
  return minIdx;
}

export default function App() {
  const [routesData, setRoutesData] = useState<any[]>(() => [...mockRoutes]);
  const [centerCoord, setCenterCoord] = useState<[number, number]>(mockCenter);
  const [activeRoutes, setActiveRoutes] = useState<Set<string>>(new Set(mockRoutes.map(r => r.id)));

  const [searchInput, setSearchInput] = useState('台北火車站');
  const [isLoading, setIsLoading] = useState(false);

  const [suggestions, setSuggestions] = useState<NearbyStation[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [nearbyStations, setNearbyStations] = useState<NearbyStation[]>([]);
  const [showNearbyList, setShowNearbyList] = useState(false);
  const suggestDebounceRef = useRef<number | null>(null);

  const [apiTestResults, setApiTestResults] = useState<ApiTestResult[]>([]);
  const [isApiTesting, setIsApiTesting] = useState(false);
  const [showApiPanel, setShowApiPanel] = useState(false);

  const [viewState, setViewState] = useState({
    longitude: mockCenter[0],
    latitude: mockCenter[1],
    zoom: 13.5,
    pitch: 45,
    bearing: 0,
    transitionDuration: 0
  });

  const [tick, setTick] = useState(0);
  const renderGeomsRef = useRef<Record<string, { path: number[][], opacity: number }>>({});
  const animationRef = useRef<Record<string, number>>({});
  const routeAnchorRef = useRef<Record<string, number>>({});

  useEffect(() => {
    routesData.forEach(r => {
      renderGeomsRef.current[r.id] = { path: r.path, opacity: 1 };
      animationRef.current[r.id] = 1;
      routeAnchorRef.current[r.id] = getClosestPointIdx(r.path, centerCoord);
    });
  }, [routesData, centerCoord]);

  useEffect(() => {
    let animationFrame: number;
    let lastTime = performance.now();
    const animate = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;
      let needsRender = false;
      routesData.forEach(route => {
        const targetVal = activeRoutes.has(route.id) ? 1 : 0;
        let currentVal = animationRef.current[route.id] ?? 1;
        if (currentVal !== targetVal) {
          needsRender = true;
          const speed = dt * 0.003;
          currentVal = targetVal === 1
            ? Math.min(1, currentVal + speed)
            : Math.max(0, currentVal - speed);
          animationRef.current[route.id] = currentVal;
          if (currentVal <= 0.001) {
            renderGeomsRef.current[route.id] = { path: [], opacity: 0 };
          } else if (currentVal >= 0.999) {
            renderGeomsRef.current[route.id] = { path: route.path, opacity: 1 };
          } else {
            const totalPts = route.path.length;
            const anchorIdx = routeAnchorRef.current[route.id] ?? Math.floor(totalPts / 2);
            const startIdx = Math.floor(anchorIdx * (1 - currentVal));
            const endIdx = totalPts - 1 - Math.floor((totalPts - 1 - anchorIdx) * (1 - currentVal));
            renderGeomsRef.current[route.id] = { path: route.path.slice(startIdx, endIdx + 1), opacity: currentVal };
          }
        }
      });
      if (needsRender) setTick(t => t + 1);
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [activeRoutes, routesData]);

  const toggleRoute = (id: string) => {
    setActiveRoutes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runSearch = async (name: string) => {
    if (!name) return;
    setIsLoading(true);
    try {
      const { routes, center } = await searchBusRoutesByStation(name);
      if (center) {
        setCenterCoord(center);
        setViewState(v => ({ ...v, longitude: center[0], latitude: center[1], transitionDuration: 1800 }));
      }
      if (routes.length > 0) {
        setRoutesData(routes);
        setActiveRoutes(new Set(routes.map(r => r.id)));
      } else {
        alert('找不到經過此站的路線或資料。');
      }
    } catch (err) {
      console.error(err);
      alert('TDX API 請求失敗，請稍後再試。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    await runSearch(searchInput);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    setShowSuggestions(true);
    if (suggestDebounceRef.current !== null) clearTimeout(suggestDebounceRef.current);
    suggestDebounceRef.current = window.setTimeout(async () => {
      if (!val) { setSuggestions([]); return; }
      const results = await getStationSuggestions(val);
      setSuggestions(results);
    }, 300);
  };

  const handleSelectSuggestion = (name: string) => {
    setSearchInput(name);
    setShowSuggestions(false);
    setSuggestions([]);
    runSearch(name);
  };

  const handleLocate = () => {
    if (!navigator.geolocation) { alert('您的瀏覽器不支援定位功能'); return; }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { longitude, latitude } = pos.coords;
        try {
          const stations = await getNearbyStations(longitude, latitude, 200);
          if (stations.length === 0) {
            alert('附近 200 公尺內未找到公車站位');
          } else {
            setNearbyStations(stations);
            setShowNearbyList(true);
            setViewState(v => ({ ...v, longitude, latitude, zoom: 16, transitionDuration: 1500 }));
          }
        } catch (err) {
          console.error(err);
          alert('定位查詢失敗，請稍後再試');
        } finally {
          setIsLocating(false);
        }
      },
      () => { alert('無法取得位置，請確認已授權定位權限'); setIsLocating(false); }
    );
  };

  const handleSelectNearbyStation = (name: string) => {
    setSearchInput(name);
    setShowNearbyList(false);
    runSearch(name);
  };

  const handleApiTest = async () => {
    setIsApiTesting(true);
    setApiTestResults([]);
    setShowApiPanel(true);
    const results = await testApiConnection();
    setApiTestResults(results);
    setIsApiTesting(false);
  };

  const layers = [
    new PathLayer({
      id: 'bus-routes',
      data: routesData.map(r => ({
        ...r,
        path: renderGeomsRef.current[r.id]?.path || [],
        opacity: renderGeomsRef.current[r.id]?.opacity ?? 1
      })).filter(r => r.path.length > 0),
      pickable: true,
      widthScale: 20,
      widthMinPixels: 4,
      getPath: (d: any) => d.path,
      getColor: (d: any) => [...d.color, Math.floor(d.opacity * 255 * 0.9)],
      getWidth: () => 1,
      jointRounded: true,
      capRounded: true,
      parameters: {
        depthTest: false,
        blendConfig: {
          srcRGB: 'src-alpha', dstRGB: 'one',
          srcAlpha: 'one', dstAlpha: 'one-minus-src-alpha',
          equation: 'func-add'
        }
      }
    }),
    new ScatterplotLayer({
      id: 'stations',
      data: [{ position: centerCoord }],
      pickable: true,
      opacity: Math.sin(tick / 15) * 0.4 + 0.6,
      stroked: true, filled: false,
      radiusMinPixels: 6, radiusMaxPixels: 15, lineWidthMinPixels: 3,
      getPosition: (d: any) => d.position,
      getLineColor: [0, 243, 255, 255]
    }),
  ];

  return (
    <>
      <div className="map-container">
        <DeckGL
          viewState={viewState}
          onViewStateChange={(e) => setViewState(e.viewState as any)}
          controller={true}
          layers={layers}
          parameters={{ clearColor: [0, 0, 0, 1] }}
        >
          <Map mapStyle={MAP_STYLE} />
        </DeckGL>
      </div>

      <div className="floating-panel">
        <div className="header">公車即時路網系統</div>

        <form onSubmit={handleSearch} className="search-box">
          {isLoading ? (
            <Loader2 className="animate-spin" size={18} color="rgba(0,243,255,0.8)" style={{ marginRight: 12 }} />
          ) : (
            <Search size={18} color="rgba(255,255,255,0.4)" style={{ marginRight: 12 }} />
          )}
          <div className="autocomplete-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder="請輸入台灣公車站名..."
              value={searchInput}
              onChange={handleInputChange}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="autocomplete-dropdown">
                {suggestions.map(s => (
                  <div key={s.uid} className="autocomplete-item" onMouseDown={() => handleSelectSuggestion(s.name)}>
                    {s.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="locate-btn" onClick={handleLocate} disabled={isLocating} title="定位附近站位">
            {isLocating ? <Loader2 className="animate-spin" size={16} /> : <LocateFixed size={16} />}
          </button>
        </form>

        {showNearbyList && (
          <div className="nearby-list">
            <div className="nearby-list-header">
              <span>附近站位（200m）</span>
              <button onClick={() => setShowNearbyList(false)}>x</button>
            </div>
            {nearbyStations.map(s => (
              <div key={s.uid} className="nearby-item" onClick={() => handleSelectNearbyStation(s.name)}>
                {s.name}
              </div>
            ))}
          </div>
        )}

        <div className="api-test-bar">
          <button className="api-test-btn" onClick={handleApiTest} disabled={isApiTesting}>
            {isApiTesting
              ? <><Loader2 className="animate-spin" size={13} style={{ marginRight: 6 }} />測試中...</>
              : <><FlaskConical size={13} style={{ marginRight: 6 }} />測試 API 連線</>
            }
          </button>
          {apiTestResults.length > 0 && (
            <button className="api-toggle-btn" onClick={() => setShowApiPanel(v => !v)}>
              {showApiPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>

        {showApiPanel && apiTestResults.length > 0 && (
          <div className="api-status-panel">
            {apiTestResults.map((r, i) => (
              <div key={i} className="api-status-row">
                <span className="api-status-icon">
                  {r.ok
                    ? <CheckCircle2 size={13} color="rgb(0,255,102)" />
                    : <XCircle size={13} color="rgb(255,60,80)" />
                  }
                </span>
                <span className="api-status-label">{r.label}</span>
                <span className={`api-status-detail ${r.ok ? 'ok' : 'fail'}`}>{r.detail}</span>
              </div>
            ))}
          </div>
        )}

        <div className="routes-list" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', paddingRight: '10px' }}>
          {routesData.map(route => {
            const isActive = activeRoutes.has(route.id);
            return (
              <div key={route.id} className="route-item" onClick={() => toggleRoute(route.id)}>
                <div className="route-info">
                  <span className="route-name" style={{
                    color: isActive ? route.neonColorStr : 'rgba(255,255,255,0.5)',
                    textShadow: isActive ? `0 0 10px ${route.neonColorStr}` : 'none'
                  }}>
                    {route.name}
                  </span>
                  <span className="route-status" style={{ color: isActive ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)' }}>
                    {isActive ? '即時追蹤中' : '已離線'}
                  </span>
                </div>
                <div className={`toggle ${isActive ? 'active' : ''}`} style={{ color: route.neonColorStr }}>
                  <div className="toggle-knob" style={{ background: isActive ? route.neonColorStr : 'rgba(255,255,255,0.2)' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
