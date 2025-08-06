const { GoogleGenerativeAI } = require('@google/generative-ai');
const { RedisService } = require('./redis');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class AIService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  getSystemPrompt() {
    return `You are kheAI, an AI financial assistant for Malaysian microbusinesses.

LANGUAGE POLICY:
- Always respond in clear, professional English
- Understand user input in any language (English, Malay, Chinese, Tamil)
- Use Malaysian business context and terminology
- Include RM currency and local regulations

CORE CAPABILITIES:
- Bookkeeping and financial planning advice
- Bitcoin treasury management for inflation protection
- Malaysian business regulations (GST, income tax, SST)
- Cash flow optimization strategies
- Real-time business insights

MALAYSIAN CONTEXT:
- Inflation rate: ~3.5% annually
- GST: 6% (where applicable)
- Microbusiness threshold: RM500,000 annually
- Common business types: kedai runcit, restaurants, services
- Bitcoin: Legal but unregulated

RESPONSE STYLE:
- Professional but friendly tone
- Use emojis sparingly for clarity
- Keep responses concise and actionable (under 200 words)
- Focus on practical, implementable advice
- Include specific RM amounts when giving recommendations
- Always prioritize business cash flow over speculative investments

BITCOIN ADVICE FRAMEWORK:
- Recommend 2-5% allocation of profits only
- Emphasize inflation protection, not speculation
- Consider business cash flow needs first
- Suggest starting small (RM50-100) to learn`;
  }

  async processQuery(userId, message) {
    try {
      // Check cache first
      const cached = await RedisService.getCachedAIResponse(message, userId);
      if (cached) {
        return cached;
      }

      // Get context
      const context = await this.buildContext(userId, message);
      
      // Generate response
      const response = await this.generateResponse(context, message);
      
      // Cache response
      await RedisService.cacheAIResponse(message, userId, response);
      
      // Store context
      await RedisService.storeAIContext(userId, message, response);
      
      return response;
    } catch (error) {
      console.error('AI processing error:', error);
      return 'Sorry, I\'m experiencing technical difficulties. Please try again.';
    }
  }

  async processQueryEnhanced(userId, message) {
    try {
      const lowerMessage = message.toLowerCase();
      
      // Check for Bitcoin price queries
      const bitcoinPriceKeywords = [
        'bitcoin price', 'btc price', 'harga bitcoin', 'bitcoin now', 
        'current bitcoin', 'bitcoin today', 'bitcoin sekarang', 'btc now',
        'bitcoin current', 'price bitcoin', 'harga btc'
      ];
      
      const isBitcoinPriceQuery = bitcoinPriceKeywords.some(keyword => 
        lowerMessage.includes(keyword)
      );
      
      if (isBitcoinPriceQuery) {
        return await this.handleBitcoinPriceQuery(userId, message);
      }
      
      // Check for Bitcoin safety queries
      const bitcoinSafetyKeywords = [
        'how to buy bitcoin', 'buy bitcoin safely', 'bitcoin safety',
        'bagaimana beli bitcoin', 'beli bitcoin selamat', 'keselamatan bitcoin',
        'bitcoin platform', 'bitcoin exchange', 'bitcoin wallet'
      ];
      
      const isBitcoinSafetyQuery = bitcoinSafetyKeywords.some(keyword => 
        lowerMessage.includes(keyword)
      );
      
      if (isBitcoinSafetyQuery) {
        return await this.handleBitcoinSafetyQuery(userId);
      }
      
      // Regular AI processing
      return await this.processQuery(userId, message);
      
    } catch (error) {
      console.error('Enhanced query processing error:', error);
      return 'Sorry, I\'m experiencing technical difficulties. Please try again.';
    }
  }

  async handleBitcoinPriceQuery(userId, message) {
    const PriceFeedsService = require('./priceFeeds');
    
    try {
      const prices = await PriceFeedsService.getCurrentPrices();
      const btcPrice = parseFloat(prices.btc_myr || 0);
      const lastUpdated = prices.updated_at;
      
      if (btcPrice > 0) {
        const metrics = await RedisService.getBusinessMetrics(userId);
        const revenue = parseFloat(metrics.total_revenue || 0);
        const expenses = parseFloat(metrics.total_expenses || 0);
        const profit = revenue - expenses;
        
        const suggestedAllocation = Math.max(profit * 0.03, 50); // 3% of profit, minimum RM50
        const btcAmount = suggestedAllocation / btcPrice;
        
        return this.getBitcoinPriceResponse(btcPrice, lastUpdated, suggestedAllocation, btcAmount, profit);
      } else {
        return 'Sorry, unable to get Bitcoin price at the moment. Please try again.';
      }
    } catch (error) {
      console.error('Bitcoin price query error:', error);
      return 'Unable to fetch Bitcoin price. Please try again later.';
    }
  }

  getBitcoinPriceResponse(btcPrice, lastUpdated, suggestedAllocation, btcAmount, profit) {
    const timeAgo = this.getTimeAgo(lastUpdated);
    
    return `🪙 BITCOIN PRICE NOW

💰 Current Price: RM${btcPrice.toLocaleString()}
🕐 Last Updated: ${timeAgo}

TREASURY ALLOCATION ADVICE:
${profit > 0 ? 
  `Based on your RM${profit.toFixed(2)} monthly profit:

💡 Suggested allocation: RM${suggestedAllocation.toFixed(2)} (3% of profit)
₿ Bitcoin amount: ${btcAmount.toFixed(8)} BTC

WHY THIS AMOUNT?
• Small enough to protect cash flow if Bitcoin drops
• Large enough to hedge against Malaysian inflation (3.5%)
• Diversifies your savings beyond MYR
• Conservative approach for business treasury` :
  `Focus on profitability first before Bitcoin allocation.
  
GENERAL ADVICE:
• Start with RM50-100 to learn
• Never invest more than you can afford to lose
• Bitcoin is volatile - treat as long-term savings
• Build emergency fund first (3-6 months expenses)`
}

IMPORTANT REMINDERS:
• Bitcoin is volatile - prices can swing 20%+ daily
• Only use profits, never operating capital
• Consider it as inflation protection, not speculation
• Secure storage is crucial - use reputable exchanges
• Understand Malaysian tax implications

Ask me: "How to buy Bitcoin safely?" for more guidance.`;
  }

  getTimeAgo(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const now = new Date();
    const updated = new Date(timestamp);
    const diffMs = now - updated;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
  }

  async handleBitcoinSafetyQuery(userId) {
    return `🔒 HOW TO BUY BITCOIN SAFELY IN MALAYSIA

RECOMMENDED PLATFORMS:
• Luno Malaysia - Beginner-friendly, local support
• Tokenize Xchange - Malaysian-regulated exchange
• Binance - Global platform (advanced users)

SECURITY STEPS:
1. VERIFY ACCOUNT: Use official Malaysian documents (MyKad)
2. ENABLE 2FA: Two-Factor Authentication is mandatory
3. SECURE EMAIL: Use dedicated email for crypto accounts
4. SAFE STORAGE: For amounts >RM1000, consider hardware wallet

HOW TO START:
1. Register account on chosen platform
2. Complete identity verification (MyKad required)
3. Deposit RM50-100 to learn the process
4. Buy Bitcoin regularly (Dollar Cost Averaging)
5. Transfer to personal wallet for large amounts

SECURITY WARNINGS:
• Never share private keys or seed phrases
• Avoid unlicensed platforms or "get rich quick" schemes
• Be careful of scams on social media
• Store backup phrases safely (offline)
• Start small and learn gradually

MALAYSIAN CONTEXT:
• Bitcoin is legal but unregulated in Malaysia
• No specific tax guidance yet - consult tax advisor
• Bank Negara Malaysia allows crypto trading
• Use only licensed exchanges for fiat conversion

Start small, learn the basics, and gradually increase your allocation as you become comfortable with the technology.`;
  }

  async buildContext(userId, message) {
    const user = await RedisService.getUser(userId);
    const recentTransactions = await this.getRecentTransactions(userId);
    const businessMetrics = await RedisService.getBusinessMetrics(userId);
    const aiHistory = await RedisService.getAIContext(userId);

    return {
      user_profile: {
        business_type: user.business_type || 'general',
        name: user.name || 'User'
      },
      recent_transactions: recentTransactions,
      business_metrics: businessMetrics,
      conversation_history: aiHistory.slice(0, 3),
      current_query: message
    };
  }

  async getRecentTransactions(userId) {
    try {
      return await RedisService.getRecentTransactions(userId, 5);
    } catch (error) {
      console.error('Error getting recent transactions:', error);
      return [];
    }
  }

  async generateResponse(context, message) {
    const prompt = `${this.getSystemPrompt()}

User Context:
- Business: ${context.user_profile.business_type}
- Name: ${context.user_profile.name}

Recent Business Activity:
${JSON.stringify(context.recent_transactions, null, 2)}

Business Metrics:
${JSON.stringify(context.business_metrics, null, 2)}

Recent Conversation:
${context.conversation_history.map(h => `User: ${h.user_message}\nAI: ${h.ai_response}`).join('\n')}

Current Query: ${message}

Provide helpful advice in clear, professional English:`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('AI generation error:', error);
      return 'Sorry, I\'m experiencing technical difficulties. Please try again.';
    }
  }

  async parseTransaction(message, userId) {
    const prompt = `Parse this Malaysian business transaction into structured data:
Message: "${message}"

The user may write in any language (English, Malay, Chinese, etc.) but extract the information and return clean English descriptions.

Extract and return ONLY valid JSON:
{
  "amount": number,
  "type": "income|expense",
  "category": "inventory|rent|utilities|marketing|supplies|revenue|rental|other",
  "description": "clean English description"
}

TRANSACTION TYPE DETECTION:
INCOME keywords: sales, income, received, dapat, terima, rental income, commission, payment received, cash in, revenue, earning, profit, dividend, interest, refund received
EXPENSE keywords: beli, buy, bayar, pay, expense, cost, spend, purchase, paid, payment, bill, fee

CATEGORY DETECTION:
- inventory: inventory, stock, barang, goods, products, merchandise
- rent: rent, sewa, rental (when it's an expense)
- rental: rental income, sewa income (when it's income)
- utilities: electric, water, internet, phone, utilities, bill, elektrik, air
- marketing: ads, marketing, promotion, iklan, advertising
- supplies: supplies, office, stationery, alat tulis
- revenue: sales, revenue, income (general business income)

EXAMPLES:
"Beli inventory RM150" → {"amount": 150, "type": "expense", "category": "inventory", "description": "Purchase inventory"}
"Sales RM500" → {"amount": 500, "type": "income", "category": "revenue", "description": "Sales revenue"}
"Rental income big room RM800" → {"amount": 800, "type": "income", "category": "rental", "description": "Rental income - big room"}
"Bayar sewa kedai RM1200" → {"amount": 1200, "type": "expense", "category": "rent", "description": "Shop rent payment"}
"Dapat commission RM200" → {"amount": 200, "type": "income", "category": "revenue", "description": "Commission received"}

RULES:
- amount must be a positive number
- type must be either "income" or "expense"
- description should be clean, professional English
- If you cannot parse a valid transaction, return null

Return ONLY the JSON object:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Validate required fields
        if (parsed.amount && 
            parsed.amount > 0 && 
            parsed.type && 
            ['income', 'expense'].includes(parsed.type) &&
            parsed.description && 
            parsed.description.length > 2) {
          return parsed;
        }
      }
      
      // Fallback: Try rule-based parsing
      return this.fallbackTransactionParsing(message);
      
    } catch (error) {
      console.error('Transaction parsing error:', error);
      // Fallback: Try rule-based parsing
      return this.fallbackTransactionParsing(message);
    }
  }

  // Fallback rule-based parsing with English descriptions
  fallbackTransactionParsing(message) {
    try {
      const lowerMessage = message.toLowerCase();
      
      // Extract amount
      const amountMatch = message.match(/rm\s*(\d+(?:\.\d{2})?)/i) || 
                         message.match(/(\d+(?:\.\d{2})?)\s*rm/i) ||
                         message.match(/(\d+(?:\.\d{2})?)/);
      
      if (!amountMatch) return null;
      
      const amount = parseFloat(amountMatch[1]);
      if (amount <= 0) return null;
      
      // Detect transaction type
      const incomeKeywords = [
        'sales', 'income', 'received', 'dapat', 'terima', 'rental income', 
        'commission', 'payment received', 'cash in', 'revenue', 'earning',
        'profit', 'dividend', 'interest', 'refund received'
      ];
      
      const expenseKeywords = [
        'beli', 'buy', 'bayar', 'pay', 'expense', 'cost', 'spend', 
        'purchase', 'paid', 'payment', 'bill', 'fee'
      ];
      
      let type = 'expense'; // default
      
      // Check for income keywords first (more specific)
      if (incomeKeywords.some(keyword => lowerMessage.includes(keyword))) {
        type = 'income';
      } else if (expenseKeywords.some(keyword => lowerMessage.includes(keyword))) {
        type = 'expense';
      }
      
      // Detect category
      let category = 'other';
      
      if (type === 'income') {
        if (lowerMessage.includes('rental') || lowerMessage.includes('sewa')) {
          category = 'rental';
        } else if (lowerMessage.includes('sales') || lowerMessage.includes('revenue')) {
          category = 'revenue';
        } else {
          category = 'revenue'; // default for income
        }
      } else {
        // Expense categories
        if (lowerMessage.includes('inventory') || lowerMessage.includes('stock') || lowerMessage.includes('barang')) {
          category = 'inventory';
        } else if (lowerMessage.includes('rent') || lowerMessage.includes('sewa')) {
          category = 'rent';
        } else if (lowerMessage.includes('electric') || lowerMessage.includes('water') || lowerMessage.includes('internet') || lowerMessage.includes('phone') || lowerMessage.includes('utilities') || lowerMessage.includes('bill')) {
          category = 'utilities';
        } else if (lowerMessage.includes('marketing') || lowerMessage.includes('ads') || lowerMessage.includes('promotion')) {
          category = 'marketing';
        } else if (lowerMessage.includes('supplies') || lowerMessage.includes('office') || lowerMessage.includes('stationery')) {
          category = 'supplies';
        }
      }
      
      // Generate clean English description
      let description = this.generateEnglishDescription(message, type, category);
      
      return {
        amount: amount,
        type: type,
        category: category,
        description: description
      };
      
    } catch (error) {
      console.error('Fallback parsing error:', error);
      return null;
    }
  }

  generateEnglishDescription(originalMessage, type, category) {
    // Clean the message and convert to English
    let description = originalMessage.trim();
    
    // Remove RM amount from description
    description = description.replace(/rm\s*\d+(?:\.\d{2})?/gi, '').trim();
    description = description.replace(/\d+(?:\.\d{2})?\s*rm/gi, '').trim();
    
    // Convert common Malay terms to English
    const translations = {
      'beli': 'Purchase',
      'bayar': 'Payment for',
      'dapat': 'Received',
      'terima': 'Received',
      'sewa': type === 'income' ? 'Rental income' : 'Rent payment',
      'kedai': 'shop',
      'barang': 'goods',
      'inventory': 'inventory',
      'stock': 'stock'
    };
    
    // Apply translations
    Object.entries(translations).forEach(([malay, english]) => {
      const regex = new RegExp(`\\b${malay}\\b`, 'gi');
      description = description.replace(regex, english);
    });
    
    // If description is too short or unclear, generate based on category
    if (description.length < 3) {
      const categoryDescriptions = {
        inventory: type === 'expense' ? 'Purchase inventory' : 'Inventory sale',
        rent: type === 'expense' ? 'Rent payment' : 'Rental income',
        rental: 'Rental income',
        utilities: 'Utilities payment',
        marketing: 'Marketing expense',
        supplies: 'Office supplies',
        revenue: 'Business revenue',
        other: type === 'expense' ? 'Business expense' : 'Business income'
      };
      
      description = categoryDescriptions[category] || 'Business transaction';
    }
    
    // Capitalize first letter
    description = description.charAt(0).toUpperCase() + description.slice(1);
    
    return description;
  }

  async generateInsights(userId) {
    const metrics = await RedisService.getBusinessMetrics(userId);
    const user = await RedisService.getUser(userId);
    const transactions = await this.getRecentTransactions(userId);

    // Check if user has any data
    const hasData = transactions.length > 0 || 
                   parseFloat(metrics.total_revenue || 0) > 0 || 
                   parseFloat(metrics.total_expenses || 0) > 0;

    if (!hasData) {
      return this.getWelcomeInsights();
    }

    const prompt = `Analyze this Malaysian microbusiness and provide 3 concise insights in English:

Business Profile: ${user.business_type}
Monthly Revenue: RM${metrics.total_revenue || 0}
Monthly Expenses: RM${metrics.total_expenses || 0}
Recent Transactions: ${transactions.length} transactions

Recent Activity:
${transactions.map(t => `${t.type}: RM${t.amount_myr} - ${t.description}`).join('\n')}

Provide exactly 3 insights in this format:
1. [Insight title]: [2-3 sentences of actionable advice]
2. [Insight title]: [2-3 sentences of actionable advice]  
3. [Insight title]: [2-3 sentences of actionable advice]

Focus on: cash flow optimization, Bitcoin treasury allocation (considering Malaysian inflation), and growth opportunities.
Keep each insight under 100 words. Use simple, clear English.
Include specific RM amounts when possible.`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      return 'Unable to generate insights at the moment. Please try again.';
    }
  }

  getWelcomeInsights() {
    return `Welcome to kheAI! 🎉

Since you're just getting started, here are 3 key tips for Malaysian microbusinesses:

1. TRACK EVERYTHING: Record every ringgit in and out. Even small expenses add up quickly. Use this bot to track: "Beli inventory RM50" or "Sales RM200"

2. INFLATION PROTECTION: With Malaysian inflation at ~3.5%, consider allocating 3-5% of profits to Bitcoin for long-term savings. Start small with RM50-100 and learn gradually.

3. CASH FLOW IS KING: Maintain at least 3 months of expenses as emergency fund. Focus on getting paid faster - offer early payment discounts to customers.

Try recording your first transaction now! 💪

Examples:
• "Sales RM500 today"
• "Rental income RM800"
• "Beli inventory RM150"`;
  }

  async parseRecurringTransaction(message, userId, frequency = null) {
    // Extract frequency from message if not provided
    if (!frequency) {
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('daily')) frequency = 'daily';
      else if (lowerMessage.includes('weekly')) frequency = 'weekly';
      else if (lowerMessage.includes('monthly')) frequency = 'monthly';
      else if (lowerMessage.includes('yearly')) frequency = 'yearly';
      else frequency = 'monthly'; // default
    }

    // Parse the basic transaction first
    const basicTransaction = await this.parseTransaction(message, userId);
    
    if (basicTransaction && basicTransaction.amount) {
      return {
        ...basicTransaction,
        frequency: frequency,
        start_date: new Date().toISOString(),
        next_due: this.calculateNextDue(new Date().toISOString(), frequency)
      };
    }
    
    return null;
  }

  async parseAsset(message, userId, assetCategory = null) {
    const prompt = `Parse this asset addition message into structured data:
Message: "${message}"

Extract and return ONLY valid JSON:
{
  "name": "asset name",
  "type": "cash|bank_savings|crypto|stocks|property|business_equity|other",
  "value": number,
  "purchase_price": number (same as value if not specified)
}

ASSET TYPE DETECTION:
- cash: cash, money, tunai
- bank_savings: bank, savings, simpanan
- crypto: bitcoin, btc, crypto, cryptocurrency
- stocks: stocks, shares, saham
- property: property, house, rumah, tanah
- business_equity: business, equity, perniagaan

EXAMPLES:
"Add cash RM5000" → {"name": "Cash", "type": "cash", "value": 5000, "purchase_price": 5000}
"Add Bitcoin RM2000" → {"name": "Bitcoin", "type": "crypto", "value": 2000, "purchase_price": 2000}

Return ONLY the JSON object:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.value && parsed.value > 0 && parsed.name) {
          return parsed;
        }
      }
      
      return this.fallbackAssetParsing(message);
    } catch (error) {
      console.error('Asset parsing error:', error);
      return this.fallbackAssetParsing(message);
    }
  }

  fallbackAssetParsing(message) {
    try {
      const lowerMessage = message.toLowerCase();
      
      // Extract amount
      const amountMatch = message.match(/rm\s*(\d+(?:\.\d{2})?)/i) || 
                         message.match(/(\d+(?:\.\d{2})?)\s*rm/i) ||
                         message.match(/(\d+(?:\.\d{2})?)/);
      
      if (!amountMatch) return null;
      
      const value = parseFloat(amountMatch[1]);
      if (value <= 0) return null;
      
      // Detect asset type
      let type = 'other';
      let name = 'Asset';
      
      if (lowerMessage.includes('cash') || lowerMessage.includes('tunai')) {
        type = 'cash';
        name = 'Cash';
      } else if (lowerMessage.includes('bitcoin') || lowerMessage.includes('btc')) {
        type = 'crypto';
        name = 'Bitcoin';
      } else if (lowerMessage.includes('bank') || lowerMessage.includes('savings')) {
        type = 'bank_savings';
        name = 'Bank Savings';
      } else if (lowerMessage.includes('stock') || lowerMessage.includes('shares')) {
        type = 'stocks';
        name = 'Stocks';
      } else if (lowerMessage.includes('property') || lowerMessage.includes('house')) {
        type = 'property';
        name = 'Property';
      }
      
      return {
        name: name,
        type: type,
        value: value,
        purchase_price: value
      };
    } catch (error) {
      console.error('Fallback asset parsing error:', error);
      return null;
    }
  }

  async parseFutureTransaction(message, userId) {
    // Extract date from message
    const datePatterns = [
      /next week/i,
      /next month/i,
      /tomorrow/i,
      /on (\d{4}-\d{2}-\d{2})/i,
      /in (january|february|march|april|may|june|july|august|september|october|november|december)/i
    ];
    
    let futureDate = new Date();
    
    if (message.toLowerCase().includes('next week')) {
      futureDate.setDate(futureDate.getDate() + 7);
    } else if (message.toLowerCase().includes('next month')) {
      futureDate.setMonth(futureDate.getMonth() + 1);
    } else if (message.toLowerCase().includes('tomorrow')) {
      futureDate.setDate(futureDate.getDate() + 1);
    }
    
    // Parse the basic transaction
    const basicTransaction = await this.parseTransaction(message, userId);
    
    if (basicTransaction && basicTransaction.amount) {
      return {
        ...basicTransaction,
        date: futureDate.toISOString()
      };
    }
    
    return null;
  }

  calculateNextDue(currentDate, frequency) {
    const date = new Date(currentDate);
    switch (frequency) {
      case 'daily': date.setDate(date.getDate() + 1); break;
      case 'weekly': date.setDate(date.getDate() + 7); break;
      case 'monthly': date.setMonth(date.getMonth() + 1); break;
      case 'yearly': date.setFullYear(date.getFullYear() + 1); break;
    }
    return date.toISOString();
  }

  async parseJournalEntry(message, userId) {
    const prompt = `Parse this accounting journal entry into structured data:
Message: "${message}"

Extract and return ONLY valid JSON:
{
  "description": "journal entry description",
  "lines": [
    {
      "account_code": "account_number",
      "account_name": "account_name", 
      "debit": number_or_0,
      "credit": number_or_0,
      "description": "line_description"
    }
  ]
}

MALAYSIAN CHART OF ACCOUNTS:
Assets: 1000-1999 (Cash=1000, Bank=1100, AR=1200, Inventory=1300, Equipment=1500)
Liabilities: 2000-2999 (AP=2000, GST=2300, Loans=2500)
Equity: 3000-3999 (Owner's Equity=3000, Retained Earnings=3100)
Revenue: 4000-4999 (Sales=4000, Service=4100, Rental=4200)
Expenses: 5000-5999 (COGS=5000, Rent=5100, Utilities=5200, Marketing=5300)

EXAMPLES:
"Paid rent RM800" → 
{
  "description": "Rent payment",
  "lines": [
    {"account_code": "5100", "account_name": "Rent Expense", "debit": 800, "credit": 0, "description": "Monthly rent"},
    {"account_code": "1100", "account_name": "Bank", "debit": 0, "credit": 800, "description": "Payment for rent"}
  ]
}

Return ONLY the JSON object:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate journal entry
        if (parsed.lines && parsed.lines.length >= 2) {
          const totalDebits = parsed.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
          const totalCredits = parsed.lines.reduce((sum, line) => sum + (line.credit || 0), 0);
          
          if (Math.abs(totalDebits - totalCredits) < 0.01) {
            return parsed;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Journal entry parsing error:', error);
      return null;
    }
  }

  async generateAccountingInsights(userId) {
    try {
      const LedgerService = require('./ledger');
      
      // Get financial statements
      const balanceSheet = await LedgerService.generateBalanceSheet(userId);
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const incomeStatement = await LedgerService.generateIncomeStatement(userId, startOfMonth, currentDate);
      
      const prompt = `Analyze this Malaysian business's financial statements and provide accounting insights:

BALANCE SHEET:
Total Assets: RM${balanceSheet.assets.total}
Total Liabilities: RM${balanceSheet.liabilities.total}
Total Equity: RM${balanceSheet.equity.total}
Is Balanced: ${balanceSheet.is_balanced}

INCOME STATEMENT (This Month):
Revenue: RM${incomeStatement.revenue.total}
Gross Profit: RM${incomeStatement.gross_profit}
Operating Income: RM${incomeStatement.operating_income}
Net Income: RM${incomeStatement.net_income}

Provide 3 key accounting insights focusing on:
1. Financial health and ratios
2. Cash flow and liquidity concerns
3. Profitability and efficiency

Keep each insight under 100 words and include specific RM amounts where relevant.`;

      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('Accounting insights error:', error);
      return 'Unable to generate accounting insights at this time.';
    }
  }
}

module.exports = new AIService();