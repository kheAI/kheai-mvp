require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const redis = require('../config/redis');
const { initializeBot } = require('./bot/bot');
const PriceFeedsService = require('./services/priceFeeds');
const { createSearchIndexes } = require('./services/redis');

// Validate environment variables
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'REDIS_URL', 'GEMINI_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  console.error('Please check your .env file or environment variables');
  process.exit(1);
}

// Initialize bot with appropriate settings
const isProduction = process.env.NODE_ENV === 'production';
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
  polling: !isProduction  // Use polling only in development
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
    await PriceFeedsService.startPriceMonitoring();
    
    // Express server setup
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
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV || 'development'
        });
      } catch (error) {
        res.status(503).json({ 
          status: 'unhealthy', 
          error: error.message 
        });
      }
    });
    
    // Root endpoint
    app.get('/', (req, res) => {
      res.json({
        service: 'kheAI Accounting Bot',
        status: 'running',
        version: '1.0.0'
      });
    });
    
    // Webhook setup for production
    if (isProduction) {
      const webhookPath = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
      
      // Webhook endpoint
      app.post(webhookPath, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      });
      
      // Set webhook URL
      const baseUrl = process.env.WEBHOOK_URL || 
                     process.env.RENDER_EXTERNAL_URL || 
                     'https://kheai-mvp.onrender.com';
      const webhookUrl = `${baseUrl}${webhookPath}`;
      
      try {
        await bot.setWebHook(webhookUrl);
        console.log(`✅ Webhook set: ${webhookUrl}`);
      } catch (error) {
        console.error('❌ Failed to set webhook:', error.message);
        console.log('⚠️ Bot may not respond to messages');
      }
    } else {
      console.log('🔄 Development mode: Using polling');
    }
    
    // Start Express server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`🚀 kheAI Bot is running on port ${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      
      if (isProduction) {
        console.log(`🌐 Service URL: https://kheai-mvp.onrender.com`);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start app:', error);
    process.exit(1);
  }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  await shutdown();
});

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down gracefully...');
  await shutdown();
});

async function shutdown() {
  try {
    if (isProduction) {
      await bot.deleteWebHook();
      console.log('✅ Webhook deleted');
    }
    await redis.disconnect();
    console.log('✅ Redis disconnected');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
startApp();