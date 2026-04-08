# NeoTransit 交通網視覺化介面 (Antigravity Theme)

這是一套以高科技、反重力螢光為主題，整合台灣交通部 TDX (Transport Data eXchange) API 的概念驗證 (PoC) 原型專案。

## 專案亮點
* **WebGL 高效渲染**：以 Deck.gl `PathLayer` 即時渲染數十條複雜的公車多邊形坐標矩陣 (WKT Linestring)。
* **自動精準向心物理收縮**：動態計算路線與目標站點的最短距離錨點 (Smart Anchor)，取消路線時能創造流暢的「由遠端朝站點高速收縮並湮滅」物理視覺反饋。
* **TDX API 完整整合**：搭載全自動的 OAuth Token 獲取邏輯，針對指定站名即時動態獲取周邊路網 ETAs 並映射 Geometry。

## 運行與開發
1. 進入專案目錄
2. 安裝套件：`npm install`
3. 啟動開發伺服器：`npm run dev`

## 版本歷程與設計文件
所有的設計規格與技術說明都存放在本地的 `docs` 資料夾中。
