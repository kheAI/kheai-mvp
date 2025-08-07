require('dotenv').config();

async function testBot() {
  console.log('🧪 Testing kheAI MVP Bot...\n');
  
  try {
    // Test 1: Environment Variables
    console.log('1️⃣ Testing environment variables...');
    const required = ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY'];
    
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing environment variable: ${key}`);
      }
      console.log(`   ✅ ${key} is set`);
    }
    
    // Test 2: Dependencies
    console.log('\n2️⃣ Testing dependencies...');
    const TelegramBot = require('node-telegram-bot-api');
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const redis = require('redis');
    const { v4: uuidv4 } = require('uuid');
    const axios = require('axios');
    const express = require('express');
    console.log('   ✅ All dependencies loaded');
    
    // Test 3: Bot Token
    console.log('\n3️⃣ Testing Telegram Bot token...');
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
    const me = await bot.getMe();
    console.log(`   ✅ Bot token valid: @${me.username}`);
    
    // Test 4: Gemini API
    console.log('\n4️⃣ Testing Gemini API...');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent('Hello');
    console.log('   ✅ Gemini API working');
    
    // Test 5: Redis (if URL provided)
    if (process.env.REDIS_URL) {
      console.log('\n5️⃣ Testing Redis connection...');
      const client = redis.createClient({ url: process.env.REDIS_URL });
      await client.connect();
      await client.ping();
      console.log('   ✅ Redis connection working');
      await client.disconnect();
    } else {
      console.log('\n5️⃣ Skipping Redis test (no REDIS_URL provided)');
    }
    
    // Test 6: Core Files
    console.log('\n6️⃣ Testing core files...');
    const fs = require('fs');
    const requiredFiles = [
      'src/app.js',
      'src/bot/bot.js',
      'src/services/ai.js',
      'src/services/redis.js'
    ];
    
    for (const file of requiredFiles) {
      if (!fs.existsSync(file)) {
        console.log(`   ⚠️ ${file} not found (may be optional)`);
      } else {
        console.log(`   ✅ ${file} exists`);
      }
    }
    
    // Test 7: Main app syntax
    console.log('\n7️⃣ Testing main app syntax...');
    require('./src/app.js');
    console.log('   ✅ src/app.js syntax OK');
    
    console.log('\n🎉 All tests passed! Bot is ready to deploy.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\n💡 Common fixes:');
    console.error('   - Check your .env file has all required tokens');
    console.error('   - Ensure Redis is running (docker run -d -p 6379:6379 redis/redis-stack)');
    console.error('   - Verify your Telegram bot token with @BotFather');
    console.error('   - Check your Gemini API key at https://makersuite.google.com/app/apikey');
    process.exit(1);
  }
}

testBot();
