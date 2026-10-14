// PM2: keeps the DVP portal running on the server and restarts it after a crash or a reboot.
//   pm2 start ecosystem.config.cjs && pm2 save        (first time)
//   pm2 reload dvp-portal                             (after an update; deploy/deploy.sh does this)
// Settings come from backend/.env (read by server.js).
module.exports = {
  apps: [{
    name: "dvp-portal",
    cwd: __dirname + "/backend",
    script: "server.js",
    exec_mode: "fork",
    instances: 1,                 // one process: sign-in codes and settings cache live in memory
    env: { NODE_ENV: "production" },
    max_memory_restart: "700M",
    time: true,                   // timestamps in `pm2 logs dvp-portal`
  }],
};
