# kheAI: Chat-based AI Accounting for Smarter Liquidity & Bitcoin Treasury 

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

Track income, control expenses, manage cashflow — effortlessly in Telegram, for Malaysian microbusinesses.

## ✨ What kheAI Does

- **Natural Language → Journal Entries**: "Paid rent RM800" becomes proper double-entry bookkeeping
- **Complete Financial Statements**: Balance Sheet, Income Statement, Cash Flow Statement
- **Bitcoin Treasury Management**: Price tracking + allocation advice for Malaysian inflation (3.5%)
- **Multi-language Support**: English, Malay, Chinese, Tamil
- **Asset & Liability Tracking**: Complete balance sheet management with auto-journal entries

## 🚀 Quick Deploy (5 minutes)

### 1. Deploy to Render

1. **Fork this repository** to your GitHub
2. **Go to [render.com](https://render.com/)** and connect GitHub
3. Create Web Service
    with these settings:

   ```
   Name: kheai-mvp
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   ```

### 2. Get Required Services

- **Telegram Bot**: Message [@BotFather](https://t.me/botfather) → `/newbot` → Copy token
- **Gemini API**: Google AI Studio → Create API Key
- **Redis Cloud**: [redis.io](https://cloud.redis.io/) → Free database with RedisJSON + RedisSearch

### 3. Set Environment Variables in Render

| Variable             | Value                     |
| :------------------- | :------------------------ |
| `NODE_ENV`           | `production`              |
| `TELEGRAM_BOT_TOKEN` | Your bot token            |
| `GEMINI_API_KEY`     | Your Gemini key           |
| `REDIS_URL`          | Your Redis connection URL |
| `WEB_HOOK`           | Deployed render URL       |

### 4. Test Your Bot

```
/start → Initialize bot
/status → Check all services
"Sales RM500" → Create transaction + journal entry
/balance_sheet → View financial statement
"Bitcoin price now?" → Get price + allocation advice
```

## 📱 Usage Examples

### Smart Transaction Processing

```
User: "Buy inventory RM150"
Bot: ✅ TRANSACTION & JOURNAL ENTRY RECORDED
     💸 Purchase inventory
     💵 Amount: RM150.00
     📚 Journal Entry: TXN-12345678
     📊 Current Balance: RM2,350.00
```

### Bitcoin Treasury Analysis

```
User: "Bitcoin price now?"
Bot: BITCOIN PRICE NOW
     💰 Current Price: RM180,230
     
     TREASURY ALLOCATION ADVICE:
     Based on your RM5,000 monthly profit:
     💡 Suggested allocation: RM150 (3% of profit)
     ₿ Bitcoin amount: 0.00083245 BTC
     
     Conservative approach for business treasury ✅
```

### Complete Financial Statements

```
User: /balance_sheet
Bot: 📊 BALANCE SHEET
     
     💰 ASSETS
     Cash: RM5,000.00
     Bank Account: RM12,500.00
     Bitcoin: RM2,000.00
     Total Assets: RM19,500.00
     
     🏛️ EQUITY
     Owner's Equity: RM17,000.00
     Current Earnings: RM2,500.00
     Total Equity: RM19,500.00
     
     Balanced: ✅
```

## 🤖 Key Commands

### Financial Management

- **Natural language**: "Sales RM500", "Paid utilities RM200"
- `/insights` - AI business analysis with accounting ratios
- `/transactions` - View all transactions
- `/export` - Download CSV records

### Accounting & Bookkeeping

- `/balance_sheet` - Real-time balance sheet
- `/income_statement` - Profit & loss statement
- `/trial_balance` - Verify books are balanced
- `/journal_edit` - Fix AI-generated journal entries

### Asset & Treasury Management

- `/assets_list` - View assets with liquidity breakdown
- **Natural**: "Add Bitcoin RM1000", "Add property RM500000"
- **Bitcoin queries**: "How to buy Bitcoin safely?"

### Business Intelligence

- `/forecast` - 6-month cashflow projections
- `/recurring_list` - Manage automated transactions
- `/recover` - Fix data issues automatically

## 🏗️ Architecture

```
src/
├── app.js                  # Main application entry
├── bot/
│   └── bot.js             # Telegram bot handlers
├── services/
│   ├── ai.js              # Gemini AI processing
│   ├── redis.js           # Data persistence
│   ├── ledger.js          # Double-entry bookkeeping
│   ├── assets.js          # Asset management
│   ├── liabilities.js     # Liability tracking
│   ├── recurring.js       # Automated transactions
│   ├── cashflow.js        # Forecasting engine
│   └── priceFeeds.js      # Bitcoin price monitoring
└── config/
    └── redis.js           # Redis configuration
```

## 🔧 Local Development

```bash
# Clone and setup
git clone https://github.com/yourusername/kheai-mvp.git
cd kheai-mvp
npm install

# Environment setup
cp .env.example .env
# Add your tokens to .env

# Start Redis
docker run -d -p 6379:6379 redis/redis-stack:latest

# Run bot
npm start
```

## 📊 Features Deep Dive

### AI-Powered Accounting

- **Smart Transaction Parsing**: Understands "Bayar sewa RM800" or "Sales revenue RM1500"
- **Auto Journal Entries**: Every transaction creates balanced double-entry records
- **Error Correction**: Edit AI mistakes with `/journal_edit`
- **Multi-currency**: Built for Malaysian Ringgit (RM)

### Bitcoin Treasury

- **Real-time Pricing**: Multiple API sources for reliability
- **Conservative Allocation**: 2-5% of profits recommendation
- **Malaysian Context**: Inflation hedging for 3.5% local inflation
- **Security Education**: Safe buying and storage guidance

### Complete Bookkeeping

- **Chart of Accounts**: Malaysian business-compliant structure
- **Financial Statements**: Balance Sheet, P&L, Cash Flow
- **Asset Management**: Track cash, crypto, property with auto-balancing
- **Compliance Ready**: GST/SST structure included

## 🌏 Malaysian Business Context

- **Currency**: Ringgit Malaysia (RM) native
- **Inflation Aware**: 3.5% annual inflation considerations
- **GST Ready**: 6% GST account structure
- **Local Terms**: Understands "kedai", "sewa", "bayar"
- **Microbusiness Focus**: Under RM500k annual revenue

## 🔒 Security & Reliability

- **Data Isolation**: Complete user data separation
- **Auto Recovery**: `/recover` command fixes data issues
- **Health Monitoring**: `/status` and `/debug` commands
- **Graceful Shutdown**: Proper webhook cleanup
- **Error Handling**: Comprehensive error catching and logging

## 📈 Production Ready

- **Webhook Support**: Automatic production webhook setup
- **Health Checks**: Built-in monitoring endpoints
- **Scalable Architecture**: Redis-based data storage
- **Background Services**: Automated price monitoring and recurring transactions
- **Audit Trail**: Complete transaction and journal entry history

## 🆘 Troubleshooting

| Issue                    | Solution                                  |
| :----------------------- | :---------------------------------------- |
| Bot not responding       | Check `TELEGRAM_BOT_TOKEN` in environment |
| AI not working           | Verify `GEMINI_API_KEY` is correct        |
| Data not saving          | Confirm Redis connection with `/status`   |
| Balance sheet unbalanced | Run `/recover` to fix data                |

## 📄 License

MIT License - Built for Malaysian microbusinesses 🇲🇾

## 🤝 Support

- **Commands**: Use `/help` in the bot
- **Health Check**: `/status` and `/debug`
- **Issues**: [GitHub Issues](https://github.com/yourusername/kheai-mvp/issues)
- **Telegram**: [@kheAIcom](https://t.me/kheAIcom)

**Ready in 5 minutes. Professional accounting in Telegram.** 

Transform your business conversations into proper financial records with AI. 🚀