# kheAI: AI Accounting for Smarter Liquidity & Bitcoin Treasury

> Track income, control expenses, manage cashflow — effortlessly in Telegram.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

## ✨ What it does

- **Natural Language → Journal Entries**: "Paid rent RM800" becomes proper double-entry bookkeeping
- **Complete Financial Statements**: Balance Sheet, Income Statement, Cash Flow
- **Bitcoin Treasury**: Price tracking + allocation advice for Malaysian inflation (3.5%)
- **Multi-language**: English, Malay, Chinese

## 📊 Key Features

- **Auto Journal Entries**: Every transaction creates balanced double-entry records
- **Financial Statements**: Real-time Balance Sheet, P&L, Cash Flow
- **Asset Management**: Track cash, Bitcoin, property with auto-balancing
- **Malaysian Context**: RM currency, GST-ready, inflation-aware Bitcoin advice
- **Multi-language AI**: Understands "Beli inventory RM150" or "Sales RM500"

## 🚀 Quick Deploy

### 1. One-Click Deploy to Render

1. Click "Deploy to Render" button above
2. Connect your GitHub account
3. Set environment variables:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token
   GEMINI_API_KEY=your_gemini_key
   REDIS_URL=your_redis_cloud_url
   ```

4. Deploy!

### 2. Get Required Services

- **Telegram Bot**: Message [@BotFather](https://t.me/botfather) → `/newbot`
- **Gemini API**: [Google AI Studio](https://makersuite.google.com/app/apikey) → Create API Key
- **Redis Cloud**: [redis.com](https://redis.com/) → Free database with RedisJSON + RedisSearch

## 📱 Usage

```
"Sales RM500" → Auto-creates journal entry
"Add Bitcoin RM1000" → Adds asset + balances books
"Bitcoin price now?" → Current price + allocation advice
/balance_sheet → Complete financial statement
/insights → AI business analysis
```

## 🛠 Local Development

```bash
git clone https://github.com/kheAI/kheai-mvp
npm install
cp .env.example .env  # Add your keys
docker run -d -p 6379:6379 redis/redis-stack:latest
npm run dev
```

## 🔧 Environment Variables

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
REDIS_URL=redis://localhost:6379
NODE_ENV=production
```

## 🆘 Troubleshooting

- **Bot not responding**: Check `TELEGRAM_BOT_TOKEN`
- **AI not working**: Verify `GEMINI_API_KEY`
- **Data not saving**: Confirm Redis connection
- **Commands**: Use `/status` to check all services

## 📄 License

MIT License - Built for Malaysian microbusinesses 🇲🇾

**Ready in 5 minutes. Professional accounting in Telegram.** 

[Get Support](https://t.me/kheAIcom) • [Documentation