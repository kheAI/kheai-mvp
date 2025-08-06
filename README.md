# kheAI: AI Accounting for Smarter Liquidity & Bitcoin Treasury

> Your intelligent CFO for Malaysian microbusinesses. Transform conversations into proper accounting records. Track income, control expenses, manage cashflow — effortlessly in Telegram.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/) [![Redis](https://img.shields.io/badge/Redis-7+-red.svg)](https://redis.io/) [![Telegram](https://img.shields.io/badge/Telegram-Bot-blue.svg)](https://telegram.org/)

## 🌟 Features

### 📚 **AI-Powered Double-Entry Bookkeeping**

- **Natural Language Processing**: "Paid rent RM800" → Automatic journal entries
- **Multi-language Support**: English, Malay, Chinese, Tamil
- **Smart Transaction Parsing**: AI understands context and creates proper accounting records
- **Auto-Generated Journal Entries**: Every transaction creates balanced double-entry records

### 📊 **Complete Financial Statements**

- **Balance Sheet**: Real-time assets, liabilities, and equity
- **Income Statement**: Profit & loss with financial ratios
- **Cash Flow Statement**: Operating, investing, and financing activities
- **Trial Balance**: Verify books are balanced with detailed account breakdown

### 🧈 **Bitcoin Treasury Management**

- **Price Monitoring**: Real-time Bitcoin prices in MYR
- **Allocation Advice**: AI-powered recommendations based on business cash flow
- **Malaysian Context**: Inflation hedging strategies for local businesses
- **Security Guidance**: Safe Bitcoin buying and storage practices

### 💫 **Advanced Business Features**

- **Recurring Transactions**: Automated monthly/weekly/yearly entries
- **Cashflow Forecasting**: 6-month projections with confidence levels
- **Liquid Asset Tracking**: Classify assets by liquidity (liquid/semi-liquid/illiquid)
- **Business Insights**: AI-generated financial health analysis

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Redis 7+
- Telegram Bot Token
- Google Gemini API Key

### Installation

**Clone the repository**

```bash
git clone https://github.com/kheAI/kheai-mvp.git
cd kheai-mvp
```

**Install dependencies**

```bash
npm install
```

**Environment Setup**

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your_gemini_api_key
NODE_ENV=development
PORT=3000
```

**Start Redis**

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or install locally
redis-server
```

**Run the application**

```bash
npm run dev
```

## 📱 Usage Examples

### Basic Transactions

```
User: "Sales RM1500 today"
Bot: ✅ TRANSACTION & JOURNAL ENTRY RECORDED
     💰 Sales revenue
     💵 Amount: RM1,500.00
     📚 Journal Entry: JE-1234567890
```

### Manual Journal Entries

```
User: "Dr 5100 RM800, Cr 1100 RM800 - Monthly rent"
Bot: ✅ JOURNAL ENTRY CREATED
     📚 Reference: JE-1234567891
     💰 Amount: RM800.00
```

### Bitcoin Treasury

```
User: "Bitcoin price now?"
Bot: 🪙 BITCOIN PRICE NOW
     💰 Current Price: RM145,230
     💡 Suggested allocation: RM150.00 (3% of profit)
     ₿ Bitcoin amount: 0.00103245 BTC
```

### Financial Statements

```
User: /balance_sheet
Bot: 📊 BALANCE SHEET
     As of: 2024-01-15
     
     💰 ASSETS
     Current Assets:
       Cash: RM5,000.00
       Bank - Current Account: RM12,500.00
     Total Assets: RM17,500.00
     
     🏛️ EQUITY
       Owner's Equity: RM15,000.00
       Current Year Earnings: RM2,500.00
     Total Equity: RM17,500.00
     
     Balanced: ✅
```

## 🏗️ Architecture

### Core Services

```
src/
├── bot/
│   └── bot.js              # Telegram bot handlers
├── services/
│   ├── ai.js               # AI processing (Gemini)
│   ├── redis.js            # Data persistence
│   ├── ledger.js           # Double-entry bookkeeping
│   ├── recurring.js        # Automated transactions
│   ├── cashflow.js         # Forecasting engine
│   ├── assets.js           # Asset management
│   └── priceFeeds.js       # Bitcoin price feeds
├── config/
│   └── redis.js            # Redis configuration
└── app.js                  # Application entry point
```

### Chart of Accounts (Malaysian Business Context)

| Code Range | Account Type | Examples                                        |
| :--------- | :----------- | :---------------------------------------------- |
| 1000-1999  | Assets       | Cash (1000), Bank (1100), Inventory (1300)      |
| 2000-2999  | Liabilities  | Accounts Payable (2000), GST Payable (2300)     |
| 3000-3999  | Equity       | Owner's Equity (3000), Retained Earnings (3100) |
| 4000-4999  | Revenue      | Sales Revenue (4000), Rental Income (4200)      |
| 5000-5999  | Expenses     | Rent (5100), Utilities (5200), Marketing (5300) |

## 🤖 Commands Reference

### Financial Management

- `start` - Initialize kheAI Accounting
- `insights` - Business analysis with accounting ratios
- `transactions` - View all recorded transactions
- `search [term]` - Search transactions by term or amount
- `delete` - Remove transactions (choose by number)
- `export` - Download complete accounting records (CSV)

### Accounting & Bookkeeping

- `journal` - Create manual journal entries
- `trial_balance` - View trial balance (verify books balanced)
- `balance_sheet` - Generate balance sheet statement
- `income_statement` - Profit & loss statement with ratios
- `cashflow_statement` - Cash flow statement
- `chart_of_accounts` - View all account codes and names

### Advanced Features

- `recurring_list` - View and delete recurring transactions
- `forecast` - 6-month cashflow projections
- `assets_list` - View liquid asset breakdown
- `bitcoin_price` - Current Bitcoin price with allocation advice

### Maintenance

- `recover` - Fix missing transactions and metrics
- `debug_balance` - Debug balance sheet vs trial balance issues
- `status` - Check all service availability

## 🔧 Configuration

### Redis Configuration

```javascript
// config/redis.js
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
  }
});
```

### AI Service Configuration

```javascript
// src/services/ai.js
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
```

## 🚀 Deployment

### Railway (Recommended)

1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Variables for Production

```env
NODE_ENV=production
TELEGRAM_BOT_TOKEN=your_production_bot_token
REDIS_URL=your_production_redis_url
GEMINI_API_KEY=your_gemini_api_key
WEBHOOK_URL=https://your-domain.com
PORT=3000
```

## 📊 Data Models

### Transaction Structure

```json
{
  "id": "uuid",
  "user_id": "telegram_user_id",
  "date": "2024-01-15T10:30:00Z",
  "amount_myr": 800.00,
  "type": "expense",
  "category": "rent",
  "description": "Monthly office rent",
  "double_entry": {
    "debit": "rent_expense",
    "credit": "cash_myr"
  }
}
```

### Journal Entry Structure

```json
{
  "id": "uuid",
  "user_id": "telegram_user_id",
  "reference": "JE-1234567890",
  "description": "Monthly rent payment",
  "total_debit": 800.00,
  "total_credit": 800.00,
  "entries": [
    {
      "account_code": "5100",
      "account_name": "Rent Expense",
      "debit_amount": 800.00,
      "credit_amount": 0
    },
    {
      "account_code": "1100",
      "account_name": "Bank - Current Account",
      "debit_amount": 0,
      "credit_amount": 800.00
    }
  ]
}
```

## 🔒 Security

- **Data Encryption**: All sensitive data encrypted at rest
- **User Isolation**: Complete data separation between users
- **API Security**: Rate limiting and input validation
- **Redis Security**: Password protection and SSL/TLS
- **Environment Variables**: Secure credential management

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://botunify-ai-academy.web.app/LICENSE) file for details.

## 🆘 Support

- **Documentation**: [GitHub Wiki](https://github.com/kheAI/kheai-mvp/wiki)
- **Issues**: [GitHub Issues](https://github.com/kheAI/kheai-mvp/issues)
- **Telegram**: [@kheAI_support](https://t.me/kheAIcom)

## 🙏 Acknowledgments

- **Google Gemini AI** - Natural language processing
- **Redis** - High-performance data storage
- **Telegram Bot API** - Conversational interface
- **Malaysian Business Community** - Real-world testing and feedback

**Made with ❤️ for Malaysian microbusinesses**

*Transform your business conversations into professional accounting records with AI.*
