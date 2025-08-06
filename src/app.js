require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const redis = require('../config/redis');
const { initializeBot } = require('./bot/bot');
const PriceFeedsService = require('./services/priceFeeds'); // Updated import
const { createSearchIndexes } = require('./services/redis');

// Validate environment variables
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'REDIS_URL', 'GEMINI_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  console.error('Please check your .env file or Railway environment variables');
  process.exit(1);
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
  polling: process.env.NODE_ENV !== 'production' 
});

async function startApp() {
  try {
    // Connect to Redis
    await redis.connect();
    console.log('✅ Redis connected successfully');
    
    // Create search indexes
    await createSearchIndexes();
    
    // Initialize bot handlers
    initializeBot(bot);
    
    // Start background services
    await PriceFeedsService.startPriceMonitoring(); // Updated call
    
    // Express server for health checks
    const app = express();
    app.use(express.json());
    
    // Health check endpoint
    app.get('/health', async (req, res) => {
      try {
        await redis.ping();
        res.json({ 
          status: 'healthy', 
          redis: 'connected',
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({ 
          status: 'unhealthy', 
          error: error.message 
        });
      }
    });
    
    // Webhook endpoint for production
    if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
      const webhookPath = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
      app.post(webhookPath, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      });
      
      // Set webhook
      const webhookUrl = `${process.env.WEBHOOK_URL}${webhookPath}`;
      await bot.setWebHook(webhookUrl);
      console.log('✅ Webhook set for production');
    }
    
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`🚀 kheAI Bot is running on port ${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start app:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  try {
    await redis.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

startApp();