import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // existing video sessions API
      '/api/video-sessions': 'http://localhost:4000',

      // channels & chat API
      '/api/channels': 'http://localhost:4000',

      // 👇 new: private messages / DMs API
      '/api/dms': 'http://localhost:4000',
    },
  },
});
