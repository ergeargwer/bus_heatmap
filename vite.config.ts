import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

// 自動動態判斷是否在 GitHub Actions 進行編譯，並自動取得倉庫名稱做為 Base URL
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const repoName = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : 'bus_heatmap';
const base = isGitHubActions ? `/${repoName}/` : '/';

export default defineConfig({
  base: base,
  plugins: [react()],
  resolve: {
    alias: {
      child_process: path.resolve(__dirname, './src/lib/child_process_shim.ts')
    }
  }
})
