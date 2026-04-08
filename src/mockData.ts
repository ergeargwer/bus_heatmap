export type Route = {
  id: string;
  name: string;
  color: [number, number, number];
  neonColorStr: string;
  path: [number, number][]; // [longitude, latitude]
};

// 以台北市信義區附近為收斂中心點
const center = [121.56, 25.04];
export const centerStation = center;

// 產生模擬的蜿蜒路徑，並確保會經過中心站點
function generatePath(startX: number, startY: number, endX: number, endY: number, segments: number) {
  const path: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    
    // 基本線性插值
    let x = startX + (endX - startX) * t;
    let y = startY + (endY - startY) * t;
    
    // 加入有機彎曲感 (Sin/Cos Noise)
    x += Math.sin(t * Math.PI * 3) * 0.008;
    y += Math.cos(t * Math.PI * 3) * 0.008;

    // 強制在路徑中間段被「吸往」中心點
    if (t > 0.3 && t < 0.7) {
      const centerPull = 1 - Math.abs(t - 0.5) * 2; // t=0.5時最強
      const ease = centerPull * centerPull * (3 - 2 * centerPull); // smoothstep
      x = x * (1 - ease) + center[0] * ease;
      y = y * (1 - ease) + center[1] * ease;
    }

    path.push([x, y]);
  }
  return path;
}

export const mockRoutes: Route[] = [
  {
    id: "R1",
    name: "Route 12A (NEON BLUE)",
    color: [0, 243, 255],
    neonColorStr: "var(--neon-blue)",
    path: generatePath(121.48, 24.98, 121.62, 25.10, 160)
  },
  {
    id: "R2",
    name: "Route 45X (ACID GREEN)",
    color: [0, 255, 102],
    neonColorStr: "var(--neon-green)",
    path: generatePath(121.54, 25.12, 121.58, 24.96, 180)
  },
  {
    id: "R3",
    name: "Route 71B (VIOLET)",
    color: [188, 19, 254],
    neonColorStr: "var(--neon-violet)",
    path: generatePath(121.60, 25.01, 121.49, 25.07, 200)
  },
  {
    id: "R4",
    name: "Route 88C (AMBER)",
    color: [255, 145, 0],
    neonColorStr: "var(--neon-orange)",
    path: generatePath(121.52, 24.95, 121.61, 25.09, 150)
  }
];
