// PM2 process file for a server without Docker (Node 22 installed, Nginx or Caddy in front).
//
//   npm ci && npm run build
//   node apps/api/dist/scripts/bootstrap.js        # once per release
//   pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
//
// Environment: put the API settings in apps/api/.env (git-ignored, readable only by the app user)
// and build the web app with API_URL=http://127.0.0.1:4100 and NEXT_PUBLIC_SITE_URL set.
module.exports = {
  apps: [
    {
      name: 'mb-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      node_args: '--enable-source-maps',
      env: { NODE_ENV: 'production', PORT: 4100, TRUST_PROXY: 1 },
      // One instance: the in-memory rate limiter and the job lease are designed for it (see DEPLOYMENT.md, Scaling).
      instances: 1,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      time: true,
    },
    {
      name: 'mb-web',
      cwd: './apps/web',
      script: '../../node_modules/next/dist/bin/next',
      args: 'start --port 3000 --hostname 127.0.0.1',
      env: { NODE_ENV: 'production' },
      instances: 1,
      max_memory_restart: '768M',
      time: true,
    },
  ],
};
