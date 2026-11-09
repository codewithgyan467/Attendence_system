import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

const isHttps = process.env.VITE_HTTPS !== 'false';

export default defineConfig({
  plugins: [
    react(),
    ...(isHttps ? [basicSsl()] : [])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    ...(isHttps ? { https: true } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-chart': ['chart.js', 'react-chartjs-2'],
          'vendor-icons': ['lucide-react']
        }
      }
    }
  }
});

