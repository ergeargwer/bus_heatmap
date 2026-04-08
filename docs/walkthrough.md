# Antigravity 交通路網核心 PoC 測試指南

我已經為您建立了一套基於 React + Vite + Deck.gl + MapLibre GL JS 的前端概念驗證 (PoC) 原型！此專案直接具現化了我們先前討論的「高科技螢光路網」與「物理動畫」規範。

## 📍 測試啟動步驟

請直接在您的終端機上執行以下指令來啟動開發環境：

```bash
cd /home/sweet/.gemini/antigravity/scratch/bus_heatmap
npm run dev
```

成功啟動後，請開啟您的瀏覽器並前往：
👉 **http://localhost:5173**

---

## 🎮 測試觀察重點 (The Antigravity Experience)

1. **向中心收縮特效 (Shrink-to-Center)**
   - 在左側的「NeoTransit System」浮動面板中，試著點擊取消 `Route 12A` 或 `Route 45X` 的勾選狀態。
   - 您會觀察到該路線的螢光線條並非單調淡出，而是以物理平滑加速 (Easing) 的方式，從畫面最遠的兩端 **向中心的目標站點（台北信義區）疾速收縮並湮滅**，完美符合「反重力收斂」的設計理念。
   - 重新勾選時，線條則會從黑洞中心向外放射狀爆發。

2. **高保真 (Hi-Fi) 動態螢光渲染**
   - 專案連接了高質感的 Carto Dark Matter 無文字底圖，排除了所有視覺干擾。
   - Deck.gl 利用 WebGL `mix-blend-mode: screen` 在多條路線如電路般交織時，交會處會產生高亮度的光暈爆發。

3. **中心脈動特效 (Pulse Animation)**
   - 地圖中央模擬的「搜尋目標站點」採用了隨時間 `requestAnimationFrame` 持續更新的 Sin 函數脈衝擴張動畫，展現如雷達鎖定的資料生命感。

4. **3D 旋轉與效能**
   - 由於這是一套全 WebGL 渲染引擎，請嘗試按住滑鼠 **右鍵** 拖曳地圖，以觀賞具有 3D 視覺傾斜 (Pitch) 時的螢光深網感。
