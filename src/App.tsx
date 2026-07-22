import React, { useState, useEffect, useRef } from 'react';
import Map from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { 
  Search, Loader2, LocateFixed, Settings, MapPin, Database, X 
} from 'lucide-react';
import { mockRoutes, centerStation as mockCenter } from './mockData';
import { 
  searchBusRoutesByStation, getStationCoordinate, getLiveBuses, LiveBus, 
  getNearbyStations, getStationSuggestions, NearbyStation, getTDXToken, clearTDXTokenCache 
} from './tdxApi';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function getClosestPointIdx(path: number[][], center: number[]) {
  if (!path || path.length === 0) return 0;
  let minIdx = 0;
  let minDist = Infinity;
  for(let i=0; i<path.length; i++) {
    const dx = path[i][0] - center[0];
    const dy = path[i][1] - center[1];
    const d = dx*dx + dy*dy;
    if(d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return minIdx;
}

export default function App() {
  // --- Basic State ---
  const [routesData, setRoutesData] = useState<any[]>(() => [...mockRoutes]);
  const [centerCoord, setCenterCoord] = useState<[number, number]>(mockCenter);
  const [activeRoutes, setActiveRoutes] = useState<Set<string>>(new Set(mockRoutes.map(r => r.id)));
  const [liveBuses, setLiveBuses] = useState<LiveBus[]>([]);
  const [hoverInfo, setHoverInfo] = useState<any>(null);
  
  const [searchInput, setSearchInput] = useState("台北火車站");
  const [isLoading, setIsLoading] = useState(false);

  const [suggestions, setSuggestions] = useState<NearbyStation[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [nearbyStations, setNearbyStations] = useState<NearbyStation[]>([]);
  const [showNearbyList, setShowNearbyList] = useState(false);
  const suggestDebounceRef = useRef<number | null>(null);

  // --- Tab & Panel State ---
  const [activeTab, setActiveTab] = useState<'controls' | 'settings'>('controls');

  // --- Credentials/Settings State ---
  const [tdxIdInput, setTdxIdInput] = useState(localStorage.getItem('tdx_client_id') || '');
  const [tdxSecretInput, setTdxSecretInput] = useState(localStorage.getItem('tdx_client_secret') || '');
  const [apiStatus, setApiStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  // DeckGL 視角狀態管理，提供飛梭 (FlyTo) 平滑定位效果
  const [viewState, setViewState] = useState({
    longitude: mockCenter[0],
    latitude: mockCenter[1],
    zoom: 13.5,
    pitch: 45,
    bearing: 0,
    transitionDuration: 0
  });

  const [tick, setTick] = useState(0); 
  const renderGeomsRef = useRef<Record<string, {path: number[][], opacity: number}>>({});
  const animationRef = useRef<Record<string, number>>({}); 
  const routeAnchorRef = useRef<Record<string, number>>({}); // 精準目標站點記憶體

  // --- Smart Path Contraction Physics ---
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
          const speed = dt * 0.003; // Easing 速率
          
          if (targetVal === 1) {
            currentVal = Math.min(1, currentVal + speed);
          } else {
            currentVal = Math.max(0, currentVal - speed);
          }
          animationRef.current[route.id] = currentVal;
          
          if (currentVal <= 0.001) {
             renderGeomsRef.current[route.id] = { path: [], opacity: 0 };
          } else if (currentVal >= 0.999) {
             renderGeomsRef.current[route.id] = { path: route.path, opacity: 1 };
          } else {
             // 終極物理收縮演算法
             const totalPts = route.path.length;
             const anchorIdx = routeAnchorRef.current[route.id] ?? Math.floor(totalPts/2);
             
             // 從邊緣向該路線接觸目標站點的位置 (anchorIdx) 高速收縮
             const startIdx = Math.floor(anchorIdx * (1 - currentVal));
             const endIdx = totalPts - 1 - Math.floor((totalPts - 1 - anchorIdx) * (1 - currentVal));
             
             renderGeomsRef.current[route.id] = { 
               path: route.path.slice(startIdx, endIdx + 1), 
               opacity: currentVal 
             };
          }
        }
      });

      if (needsRender) {
        setTick(t => t + 1); 
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [activeRoutes, routesData]); 

  // --- Live Bus Polling Hook ---
  useEffect(() => {
    let interval: number;
    let isSubscribed = true;

    const fetchBuses = async () => {
      if (activeRoutes.size === 0) {
        if (isSubscribed) setLiveBuses([]);
        return;
      }
      try {
        const activeIds = Array.from(activeRoutes);
        const buses = await getLiveBuses(activeIds);
        if (isSubscribed) {
          setLiveBuses(buses);
        }
      } catch (err) {
        console.error("Live bus polling error", err);
      }
    };

    fetchBuses();
    interval = window.setInterval(fetchBuses, 15000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [activeRoutes]);

  // --- Interactive Functions ---
  const toggleRoute = (id: string) => {
    setActiveRoutes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const executeSearch = async (term: string) => {
    if(!term) return;
    setIsLoading(true);
    try {
      const coord = await getStationCoordinate(term);
      const newRoutes = await searchBusRoutesByStation(term);
      
      if(coord) {
        setCenterCoord(coord as [number, number]);
        setViewState(v => ({...v, longitude: coord[0], latitude: coord[1], transitionDuration: 1800})); // 優雅飛梭
      }
      
      if(newRoutes.length > 0) {
        setRoutesData(newRoutes);
        setActiveRoutes(new Set(newRoutes.map(r => r.id)));
      } else {
        alert("找不到經過此站的路線或資料。");
      }
    } catch(err) {
      console.error(err);
      alert("載入路線幾何失敗");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(searchInput);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (!val) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    if (suggestDebounceRef.current) {
      window.clearTimeout(suggestDebounceRef.current);
    }
    
    suggestDebounceRef.current = window.setTimeout(async () => {
      try {
        const res = await getStationSuggestions(val);
        setSuggestions(res);
        setShowSuggestions(true);
      } catch (err) {
        console.error(err);
      }
    }, 300);
  };

  const handleSelectSuggestion = (name: string) => {
    setSearchInput(name);
    setShowSuggestions(false);
    executeSearch(name);
  };

  const handleSelectNearbyStation = (name: string) => {
    setSearchInput(name);
    setShowNearbyList(false);
    executeSearch(name);
  };

  const handleLocate = () => {
    if (!navigator.geolocation) {
      alert('您的瀏覽器不支援定位功能');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { longitude, latitude } = pos.coords;
        try {
          const res = await getNearbyStations(longitude, latitude, 100);
          if (res.length > 0) {
            setNearbyStations(res);
            setShowNearbyList(true);
            setViewState(v => ({...v, longitude, latitude, transitionDuration: 1800}));
          } else {
            alert('附近 100 公尺內未找到公車站位');
          }
        } catch (err) {
          console.error(err);
          alert('定位或查詢失敗');
        } finally {
          setIsLocating(false);
        }
      },
      (err) => {
        console.error(err);
        alert('無法取得您的位置');
        setIsLocating(false);
      }
    );
  };

  // --- API Testing & Settings Save ---
  const handleTestApi = async () => {
    setApiStatus('testing');
    try {
      const token = await getTDXToken();
      if (token) {
        setApiStatus('success');
        alert("API 連線測試成功！已成功取得 TDX 授權。");
      } else {
        setApiStatus('error');
        alert("API 連線異常：無法取得資料。");
      }
    } catch (err) {
      console.error(err);
      setApiStatus('error');
      alert("API 連線失敗，請檢查網路或 API 密鑰。");
    }
  };

  const handleSaveTdxSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tdxIdInput.trim() && tdxSecretInput.trim()) {
      localStorage.setItem('tdx_client_id', tdxIdInput.trim());
      localStorage.setItem('tdx_client_secret', tdxSecretInput.trim());
    } else {
      localStorage.removeItem('tdx_client_id');
      localStorage.removeItem('tdx_client_secret');
    }
    clearTDXTokenCache();
    
    setIsLoading(true);
    try {
      const token = await getTDXToken();
      if (token) {
        alert("TDX API 金鑰已變更並成功驗證！");
      }
    } catch (err: any) {
      alert("金鑰驗證失敗：" + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Deck.gl Layers ---
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
          srcRGB: 'src-alpha',
          dstRGB: 'one',
          srcAlpha: 'one',
          dstAlpha: 'one-minus-src-alpha',
          equation: 'func-add'
        }
      }
    }),
    new ScatterplotLayer({
      id: 'stations',
      data: [{position: centerCoord}],
      pickable: true,
      opacity: Math.sin(tick / 15) * 0.4 + 0.6,
      stroked: true,
      filled: false,
      radiusScale: 1,
      radiusMinPixels: 6,
      radiusMaxPixels: 15,
      lineWidthMinPixels: 3,
      getPosition: (d: any) => d.position,
      getLineColor: [0, 243, 255, 255]
    }),
    new ScatterplotLayer({
      id: 'live-buses',
      data: liveBuses,
      pickable: true,
      opacity: 0.9 + Math.sin(tick / 10) * 0.1, // Breathing effect
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 4,
      radiusMaxPixels: 8,
      lineWidthMinPixels: 2,
      getPosition: (d: LiveBus) => d.position,
      getFillColor: (d: LiveBus) => {
        const route = routesData.find(r => r.id === d.routeUid);
        return route ? [...route.color, 255] : [255, 255, 255, 255];
      },
      getLineColor: [255, 255, 255, 255],
      onHover: info => setHoverInfo(info),
      updateTriggers: {
        getFillColor: [routesData],
        opacity: [tick]
      }
    })
  ].filter(Boolean);

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
        
        {hoverInfo && hoverInfo.object && (
          <div className="tooltip-container" style={{
            left: hoverInfo.x,
            top: hoverInfo.y
          }}>
            <div className="tooltip-plate">{hoverInfo.object.plateNumb}</div>
            <div className="tooltip-detail">路線: {hoverInfo.object.routeName}</div>
            <div className="tooltip-detail">時速: {hoverInfo.object.speed} km/h</div>
          </div>
        )}
      </div>

      <div className="floating-panel">
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>NeoTransit 視覺化網頁版</span>
          <button 
            type="button"
            onClick={handleTestApi} 
            disabled={apiStatus === 'testing'}
            style={{
              background: 'rgba(0, 0, 0, 0.4)', border: '1px solid',
              borderColor: apiStatus === 'success' ? '#00ff66' : apiStatus === 'error' ? '#ff0055' : 'rgba(0, 243, 255, 0.4)',
              borderRadius: '4px',
              color: apiStatus === 'success' ? '#00ff66' : apiStatus === 'error' ? '#ff0055' : 'rgba(0, 243, 255, 0.8)',
              cursor: apiStatus === 'testing' ? 'not-allowed' : 'pointer', 
              padding: '4px 8px', fontSize: '10px', display: 'flex', alignItems: 'center', transition: 'all 0.2s',
              letterSpacing: '1px'
            }}
          >
            {apiStatus === 'testing' && <Loader2 size={10} className="animate-spin" style={{marginRight: '4px'}}/>}
            測試 TDX
          </button>
        </div>

        {/* Tab Selector */}
        <div className="panel-tabs">
          <button 
            type="button" 
            className={`tab-btn ${activeTab === 'controls' ? 'active' : ''}`}
            onClick={() => setActiveTab('controls')}
          >
            <MapPin size={14} /> 地圖控制
          </button>
          <button 
            type="button" 
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={14} /> 系統設定
          </button>
        </div>

        {/* Tab 1: Map Controls */}
        {activeTab === 'controls' && (
          <div className="tab-content">
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
                  onBlur={() => setShowSuggestions(false)}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {suggestions.map(s => (
                      <div
                        key={s.uid}
                        className="autocomplete-item"
                        onMouseDown={() => handleSelectSuggestion(s.name)}
                      >
                        {s.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button 
                type="button" 
                className="locate-btn" 
                onClick={handleLocate}
                disabled={isLocating}
              >
                {isLocating ? <Loader2 className="animate-spin" size={16} /> : <LocateFixed size={16} />}
              </button>
            </form>

            {showNearbyList && (
              <div className="nearby-list">
                <div className="nearby-list-header">
                  <span>附近站位（100m）</span>
                  <button onClick={() => setShowNearbyList(false)}><X size={12} /></button>
                </div>
                {nearbyStations.map(s => (
                  <div
                    key={s.uid}
                    className="nearby-item"
                    onClick={() => handleSelectNearbyStation(s.name)}
                  >
                    {s.name}
                  </div>
                ))}
              </div>
            )}

            <div className="routes-list" style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: '10px' }}>
              {routesData.map(route => {
                const isActive = activeRoutes.has(route.id);
                return (
                  <div 
                    key={route.id} 
                    className="route-item"
                    onClick={() => toggleRoute(route.id)}
                  >
                    <div className="route-info">
                      <span className="route-name" style={{ 
                        color: isActive ? route.neonColorStr : 'rgba(255,255,255,0.5)',
                        textShadow: isActive ? `0 0 10px ${route.neonColorStr}` : 'none'
                      }}>
                        {route.name}
                      </span>
                      <span className="route-status" style={{ color: isActive ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)' }}>
                        {isActive ? '即時追蹤中' : '無即時資料'}
                      </span>
                    </div>
                    
                    <div className={`toggle ${isActive ? 'active' : ''}`} style={{ color: route.neonColorStr }}>
                      <div 
                        className="toggle-knob" 
                        style={{ background: isActive ? route.neonColorStr : 'rgba(255,255,255,0.2)' }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: System Settings */}
        {activeTab === 'settings' && (
          <div className="tab-content">
            {/* TDX Credentials Settings */}
            <form onSubmit={handleSaveTdxSettings} className="settings-group">
              <div className="settings-title">
                <Database size={14} /> 台灣 TDX API 憑證自訂
              </div>
              <div className="form-field">
                <label>Client ID</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="留空即使用 PoC 展示金鑰" 
                  value={tdxIdInput} 
                  onChange={(e) => setTdxIdInput(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>Client Secret</label>
                <input 
                  type="password" 
                  className="form-input" 
                  placeholder="留空即使用 PoC 展示金鑰" 
                  value={tdxSecretInput} 
                  onChange={(e) => setTdxSecretInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-submit">
                驗證並儲存 TDX 憑證
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
