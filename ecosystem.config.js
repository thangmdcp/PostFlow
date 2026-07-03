/**
 * PM2 config cho Hostinger VPS
 * Cài PM2: npm install -g pm2
 * Deploy:  pm2 start ecosystem.config.js
 * Monitor: pm2 monit
 * Logs:    pm2 logs
 */

module.exports = {
  apps: [
    {
      name: "postflow-web",
      script: "node_modules/.bin/next",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
    },
    {
      name: "postflow-cron",
      script: "dist/cron-worker.js",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
