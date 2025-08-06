# 🚀 kheAI MVP

**AI Bookkeeper with Bitcoin Treasury Management for Malaysian Microbusinesses**

## 🎯 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/kheAI/kheai-mvp
cd kheai-mvp
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Required Environment Variables
- `TELEGRAM_BOT_TOKEN` - Get from @BotFather on Telegram
- `REDIS_URL` - Redis Cloud connection string
- `GEMINI_API_KEY` - Google AI Studio API key

### 4. Local Development

```bash
npm install
npm run dev
```

### 5. Deploy 
```

## 🏗️ Architecture

- **Frontend**: Telegram Bot
- **Backend**: Node.js + Express
- **Database**: Redis Stack (JSON, Search, Streams, TimeSeries)
- **AI**: Google Gemini Pro
- **Deployment**: Render

## 🔧 Features

- 💬 Natural language transaction recording
- 🧾 Automated double-entry bookkeeping
- Bitcoin treasury management
- 🧠 AI-powered business insights
- ⚡ Real-time performance with Redis
- 🇲🇾 Malaysian business context

## 📊 Bot Commands

- `/start` - Initialize bot
- `/setup` - Configure business profile
- `/insights` - Get business analysis
- `/search [query]` - Search transactions
- `/help` - Show all commands

## 🧪 Testing

```bash
# Test Redis connection
curl http://localhost:3000/health

# Test bot
Send /start to your Telegram bot
```

## 🚀 Production Deployment

1. Set up Redis Cloud with required modules
2. Deploy to Render with environment variables
3. Set webhook for production (optional)
4. Monitor with health endpoint

## 📝 License

MIT License - see LICENSE file for details
