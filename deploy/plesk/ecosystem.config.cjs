/**
 * PM2 Ecosystem Config — AutoResolve API Server
 * Place this file at ~/autoresolve/ecosystem.config.cjs on the Plesk server.
 * Run: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "autoresolve-api",
      script: "./dist/index.cjs",
      cwd: "/var/www/vhosts/refundgod.fans/autoresolve",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        PUBLIC_DOMAIN: "refundgod.fans",
      },
      error_file: "/var/log/pm2/autoresolve-error.log",
      out_file: "/var/log/pm2/autoresolve-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
