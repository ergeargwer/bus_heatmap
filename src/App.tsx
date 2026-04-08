import React, { useState, useEffect, useRef } from 'react';
import Map from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Search, Loader2 } from 'lucide-react';
import { mockRoutes, centerStation as mockCenter } from './mockData';
import { searchBusRoutesByStation, getStationCoordinate } from './tdxApi';

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
  const [routesData, setRoutesData] = useState<any[]>(() => [...mockRoutes]);
  const [centerCoord, setCenterCoord] = useState<[number, number]>(mockCenter);
  const [activeRoutes, setActiveRoutes] = useState<Set<string>>(new Set(mockRoutes.map(r => r.id)));
  
  const [searchInput, setSearchInput] = useState("台北火車站");
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    routesData.forEach(r => {
      renderGeomsRef.current[r.id] = { path: r.path, opacity: 1 };
      animationRef.current[r.id] = 1;
      // 在新資料進來時，為每條路徑完美計算出與目標站點最短距離的那個點，作為物理收縮的錨點！
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

  const toggleRoute = (id: string) => {
    setActiveRoutes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!searchInput) return;
    setIsLoading(true);
    try {
      // 即時串接 TDX 尋找最新地理座標與路網資料！
      const coord = await getStationCoordinate(searchInput);
      const newRoutes = await searchBusRoutesByStation(searchInput);
      
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
      alert("TDX API Request Failed");
    } finally {
      setIsLoading(false);
    }
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
      </div>

      <div className="floating-panel">
        <div className="header">NeoTransit System (LIVE TDX)</div>
        
        <form onSubmit={handleSearch} className="search-box">
          {isLoading ? (
            <Loader2 className="animate-spin" size={18} color="rgba(0,243,255,0.8)" style={{ marginRight: 12 }} />
          ) : (
            <Search size={18} color="rgba(255,255,255,0.4)" style={{ marginRight: 12 }} />
          )}
          <input 
            type="text" 
            className="search-input" 
            placeholder="請輸入台灣公車站名..." 
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>

        <div className="routes-list" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', paddingRight: '10px' }}>
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
                    {isActive ? 'LIVE TRACKING' : 'OFFLINE'}
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
    </>
  );
}
