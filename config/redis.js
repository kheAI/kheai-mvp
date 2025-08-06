const redis = require('redis');

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    connectTimeout: 60000,
    lazyConnect: true,
    reconnectStrategy: (retries) => Math.min(retries * 50, 500)
  }
});

client.on('error', (err) => console.log('❌ Redis Client Error:', err));
client.on('connect', () => console.log('✅ Connected to Redis'));
client.on('reconnecting', () => console.log('🔄 Reconnecting to Redis...'));

module.exports = client;