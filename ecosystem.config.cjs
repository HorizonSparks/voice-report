module.exports = {
  apps: [{
    name: 'voice-report',
    script: 'server/index.js',
    watch: true,
    ignore_watch: [
      'node_modules',
      'dist',
      'database',
      'client',
      '.git',
      'audio',
      'photos',
      'message-audio',
      'message-photos',
      'reports',
      'forms',
      'certs',
      '.challenges',
      '*.log',
    ],
    env: {
      NODE_ENV: 'production',
    },
  }],
};
