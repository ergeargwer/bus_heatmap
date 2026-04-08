# Antigravity 交通路網視覺化 - 技術規格與動畫設計

這份文件提供了反重力 (Antigravity Theme) 視覺化介面的技術選型建議與客製化物理動畫的數學模型與規範。

## 1. 前端架構與互動邏輯建議

### 核心技術選型：**Mapbox GL JS + Deck.gl**
* **為什麼不是 React Flow?** React Flow 主要針對的是「節點式拓樸圖」(Node-based diagrams)，缺乏真實世界地理座標系統 (GIS/Web Mercator) 的支援，因此無法準確反映公車路線在城市地圖上的實際彎曲度與地理位置（Shape Geometry）。
* **為什麼選 Deck.gl?** Deck.gl 是一套基於 WebGL 的資料視覺化框架，能輕易渲染數十萬級別的地理座標物件。針對「螢光流動效果」，利用 Deck.gl 的 `TripsLayer` 或繼承自定義 `PathLayer` 來調整 Shader 效果，不但效能極高，視覺張力也遠勝一般 SVG、DOM 操作或受限的 Canvas API。

### 互動資料流 (Data Flow) - TDX API 整合
1. **站點輸入 (Input)**：使用者於浮動搜尋框輸入站名，透過 TDX `/v2/Bus/Station/City/{City}` 查詢並提供 Auto-complete 給使用者選擇。
2. **獲取經過路線**：得到該站確切資訊後，查詢周邊路線，獲取所有會經過該站點的路線編號 (Route ID)。
3. **渲染路線幾何 (Geometry)**：
   - 呼叫 `/v2/Bus/Shape/City/{City}` 取得各別路線的地理座標 (`Geometry`)。
   - 將幾何轉換為 GeoJSON 或原生座標陣列提供給 Deck.gl 資料源。
4. **自動聚焦 (Auto-zoom)**：
   - 即時計算當下畫面上所有顯示中線條的座標集合。
   - 使用 `@turf/bbox` (Turf.js) 計算出最佳視角的全域 Bounding Box：`turf.bbox(turf.featureCollection(lines))`。
   - 呼叫 Mapbox 的 `map.fitBounds(bbox, { padding: 40, duration: 1200 })` 或 `map.flyTo()` 自動以電影般的 easing 效果平滑自動縮放至充滿螢幕。

---

## 2. 螢光流動效果 (Fluorescent Fluid Motion) 實作機制

*   **視覺設定**：使用 `PathLayer` 作為基礎繪製，線寬設定約在 `3-5px`。配合 Mapbox 自訂的全黑底圖風格（拔除大部分原本的道路網與所有文字標籤以免干擾視覺）。
*   **高科技螢光效果 (Glow & Bloom Effect)**：
    *   **作法 1 (CSS 疊加)**：在地圖 Canvas 的外層以 CSS `mix-blend-mode: screen` 和 `filter: drop-shadow(0 0 8px {neonColor})` 來做簡易光暈。
    *   **作法 2 (WebGL Post-Processing)**：(推薦作法) 利用 Deck.gl 內建的 `@deck.gl/post-process` 取用 `BloomEffect`，可以控制 `threshold`, `intensity` 等參數，製造出最擬真且高質感的霓虹燈管渲染感。
*   **資料流動感 (Fluid Motion)**：
    *   將公車路線視為 `TripsLayer` 中飛梭車輛的行駛軌跡。設定較長的 `trailLength`，隨著應用程式的 `currentTime` (requestAnimationFrame) 無限增加，便可呈現出一道道光束穿梭於都市暗網間的反重力科技感。

---

## 3. 「向中心點收縮並消失」物理動畫規範 (Shrink-to-Center)

為了極致發揮反重力科技感，當使用者從側邊面板取消（Untoggle）特定路網時，線條不能只是單調地 `opacity: 0` 淡出，而是需從畫面最遠的兩端「向使用者的目標站點 (中心點) 收縮並消失」。

### 動畫參數與物理設定
*   **動畫時間 (Duration)**: 建議設在 `400ms` 至 `600ms` 之間，避免過長造成拖沓。
*   **貝茲曲線 (Easing Function)**: `Cubic-Bezier(0.55, 0.055, 0.675, 0.19)` (Ease-in) 或是更具彈性質感的 `Ease-in-back`。讓收斂時帶有一種被中心點黑洞引力「強力吸回」的物理加速感。
*   **收縮錨點 (Origin/Center)**：
    每一條路線均有其原本的座標數組 `[[lon1, lat1], ..., [lon_center, lat_center], ..., [lon_N, lat_N]]`。
    此處的 **Anchor (中心點)** 設定為使用者最初輸入的「搜尋站點座標」。

### Shader 實作演算法邏輯
若要精細操作，需客製 Deck.gl 的 PathLayer Shader：
1. **長度比例計算 (Length Ratio)**：
   先行將此條線路總長定義為 `1.0`。計算**目標站點 (中心點)** 在這條路線上對應的距離比例，假設為 `TargetRatio = 0.4`。這個比例將透過 Vertex Attribute 傳給 Shader。
2. **收縮變數 (`u_shrink`)**：
   定義一個動畫 Uniform 變數 `u_shrink`，隨時間由 `0.0` 增至 `1.0`。
3. **片段渲染邏輯 (Fragment Control)**：
   在每一幀更新時，決定該線條的有效顯示區間：
   - 起點 (Start) 從 `0.0` 逐漸往 `TargetRatio` 位移：`current_start = u_shrink * TargetRatio`
   - 終點 (End) 從 `1.0` 逐漸往 `TargetRatio` 位移：`current_end = 1.0 - (u_shrink * (1.0 - TargetRatio))`
   - 在 Fragment Shader 中確認當下象素位置的長度比是否落在 `[current_start, current_end]` 區間內，若在其外則丟棄該像素 (`discard`)。
   當 `u_shrink = 1.0`，起終點交會在 `TargetRatio`，線條即完美收斂消失。
4. **視覺反饋增強 (Visual Feedback Optional)**：
   在動畫收尾階段 (如 `u_shrink > 0.85` 時)，對 `current_start` 或 `current_end` 處施加短暫的高亮度閃爍 (Flash/Burst) 計算，讓最後光點消散時有資料湮滅的能量震盪感。
