# 高科技公車路線視覺化介面 (Antigravity Theme) 實作計畫

這是一份針對您要求的「反重力主題」高科技感公車路線視覺化介面的設計與實作計畫。

## 目標回顧
1. **視覺原型**：深海藍/純黑背景、螢光色系流體線條、極簡站點圓圈、浮動半透明搜尋框與側邊/底部路線清單。
2. **前後端邏輯**：串接 TDX API 取得站點與路線資訊，即時動態呈現。
3. **物理動畫規範**：取消路線時線條「向中心點收縮並消失」，產生反重力、高科技的資料流動感。

---

## 提案設計與產出項目

### 1. 視覺設計 (Hi-Fi Prototype)
我已經使用影像生成工具為您產出了一張高保真視覺原型圖，呈現純黑背景、螢光動態線條、浮動搜尋框與側邊清單。

![hifi_bus_route_prototype_1775613884065.png](/home/sweet/.gemini/antigravity/brain/dce787e3-b47a-4f9d-b950-110924638b90/hifi_bus_route_prototype_1775613884065.png)

### 2. 互動邏輯與前端技術架構建議 (將獨立產出文件)
我將撰寫一份詳細的技術建議文件，核心技術選型建議如下：
* **地圖/圖層渲染引擎**：建議使用 **Deck.gl + Mapbox GL JS**。Deck.gl 專為大規模 WebGL 資料視覺化設計，非常適合渲染「發光 (Glow) 線條」與實現複雜的 GPU 級別物理動畫與流體效果（Fluid Motion）。React Flow 較適合靜態拓墣圖，不適合真實地理座標的平滑縮放與複雜路網渲染。
* **資料獲取 (TDX API)**：
  1. `GET /v2/Bus/Station/NearBy`：輸入站點或座標取得周邊站點。
  2. `GET /v2/Bus/Route/City/{City}`：取得經過此站的路線清單。
  3. `GET /v2/Bus/Shape/City/{City}`：取得路線 Geometry 來渲染 PathLayer。

### 3. 物理動畫與收縮規範 (Physics Animation Spec)
將詳細設計一套動畫數學與事件機制：
* **線條收縮 (Shrink to Center)**：使用者取消勾選時，會觸發一個 ease-in-back 或 custom Bezier 曲線的動畫。
* **技術作法**：透過 Deck.gl 的 `PathStyleExtension` 或針對 Shader 寫自定義特效，將路線的 Render Progress 從 1 倒扣至 0，使其產生從沿線各點往目標站點（中心點）倒退收縮的視覺。
* **自動縮放 (Auto-Zoom)**：選取多條路線時，利用 Turf.js 計算 bounding box (Turf.bbox)，再傳給 Mapbox 呼叫 `fitBounds` 搭配 `flyTo` 動畫，實現平滑的自動視角拉伸。

---

> [!IMPORTANT]  
> ## 使用者確認事項 (User Review Required)
> 1. 您是否希望我除了產出 **技術建議與動畫規範文件** 之外，也要 **實際撰寫一份前端概念驗證程式碼 (PoC Prototype)**（例如使用 Vite + Deck.gl 建立一個能跑在瀏覽器的雛型）？
> 2. 生成的視覺原型是否符合您的期待，或者有特定的色碼或排列需要調整？
>
> 待您確認後，我將立即產出完整規範文件或開始建立程式碼專案。
