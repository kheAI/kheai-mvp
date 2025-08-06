const { GoogleGenerativeAI } = require('@google/generative-ai');
const { RedisService } = require('./redis');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class AIService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async processQuery(userId, message) {
    try {
      // Check cache first for other queries
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
      // Get current Bitcoin price
      const prices = await PriceFeedsService.getCurrentPrices();
      const btcPrice = parseFloat(prices.btc_myr || 0);
      const lastUpdated = prices.updated_at;
      
      if (btcPrice > 0) {
        const user = await RedisService.getUser(userId);
        const metrics = await RedisService.getBusinessMetrics(userId);
        const revenue = parseFloat(metrics.total_revenue || 0);
        const expenses = parseFloat(metrics.total_expenses || 0);
        const profit = revenue - expenses;
        
        // Calculate suggested allocation (2-5% of profit)
        const suggestedAllocation = Math.max(profit * 0.03, 50); // 3% of profit, minimum RM50
        const btcAmount = suggestedAllocation / btcPrice;
        
        const priceMessage = user.language === 'ms' ? 
          this.getBitcoinPriceMalay(btcPrice, lastUpdated, suggestedAllocation, btcAmount, profit) :
          this.getBitcoinPriceEnglish(btcPrice, lastUpdated, suggestedAllocation, btcAmount, profit);
        
        return priceMessage;
      } else {
        const user = await RedisService.getUser(userId);
        return user.language === 'ms' ? 
          'Maaf, tidak dapat mendapatkan harga Bitcoin pada masa ini. Sila cuba lagi.' :
          'Sorry, unable to get Bitcoin price at the moment. Please try again.';
      }
    } catch (error) {
      console.error('Bitcoin price query error:', error);
      return 'Unable to fetch Bitcoin price. Please try again later.';
    }
  }

  getBitcoinPriceEnglish(btcPrice, lastUpdated, suggestedAllocation, btcAmount, profit) {
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
• Small enough to not hurt your business if Bitcoin drops
• Large enough to protect against Malaysian inflation (3.5%)
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
• Consider it as inflation protection, not get-rich-quick
• Secure storage is crucial - use reputable exchanges
• Understand Malaysian tax implications

Ask me: "How to buy Bitcoin safely?" for more guidance.`;
  }

  getBitcoinPriceMalay(btcPrice, lastUpdated, suggestedAllocation, btcAmount, profit) {
    const timeAgo = this.getTimeAgo(lastUpdated);
    
    return `🪙 HARGA BITCOIN SEKARANG

💰 Harga Semasa: RM${btcPrice.toLocaleString()}
🕐 Kemaskini Terakhir: ${timeAgo}

NASIHAT PERUNTUKAN TREASURY:
${profit > 0 ? 
  `Berdasarkan keuntungan bulanan RM${profit.toFixed(2)}:

💡 Cadangan peruntukan: RM${suggestedAllocation.toFixed(2)} (3% keuntungan)
₿ Jumlah Bitcoin: ${btcAmount.toFixed(8)} BTC

KENAPA JUMLAH INI?
• Cukup kecil untuk tidak menjejaskan perniagaan jika Bitcoin jatuh
• Cukup besar untuk lindungi dari inflasi Malaysia (3.5%)
• Pelbagaikan simpanan selain MYR
• Pendekatan konservatif untuk treasury perniagaan` :
  `Fokus pada keuntungan dulu sebelum peruntukan Bitcoin.
  
NASIHAT UMUM:
• Mula dengan RM50-100 untuk belajar
• Jangan laburkan lebih dari yang mampu rugi
• Bitcoin tidak stabil - anggap sebagai simpanan jangka panjang
• Bina dana kecemasan dulu (3-6 bulan perbelanjaan)`
}

PERINGATAN PENTING:
• Bitcoin tidak stabil - harga boleh berubah 20%+ sehari
• Guna keuntungan sahaja, bukan modal operasi
• Anggap sebagai perlindungan inflasi, bukan cepat kaya
• Penyimpanan selamat penting - guna exchange bereputasi
• Faham implikasi cukai Malaysia

Tanya saya: "Bagaimana beli Bitcoin dengan selamat?" untuk panduan lanjut.`;
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
    const user = await RedisService.getUser(userId);
    
    if (user.language === 'ms') {
      return `🔒 PANDUAN BELI BITCOIN DENGAN SELAMAT

PLATFORM YANG DISYORKAN DI MALAYSIA:
• Luno Malaysia - Mudah untuk pemula
• Tokenize Xchange - Exchange tempatan
• Binance - Platform global (advanced)

LANGKAH KESELAMATAN:
1. VERIFIKASI AKAUN: Gunakan dokumen rasmi Malaysia
2. 2FA WAJIB: Aktifkan Two-Factor Authentication
3. EMAIL SELAMAT: Guna email khusus untuk crypto
4. SIMPANAN SELAMAT: Untuk jumlah besar, guna hardware wallet

CARA MULA:
1. Daftar akaun di platform pilihan
2. Verifikasi identiti (MyKad)
3. Deposit RM50-100 untuk belajar
4. Beli Bitcoin secara berkala (DCA)
5. Pindah ke wallet peribadi jika >RM1000

PERINGATAN:
• Jangan kongsi private keys
• Elak platform tidak berlesen
• Berhati-hati dengan scam
• Simpan backup phrase dengan selamat

Mula kecil, belajar dulu! 🎓`;
    } else {
      return `🔒 HOW TO BUY BITCOIN SAFELY

RECOMMENDED PLATFORMS IN MALAYSIA:
• Luno Malaysia - Beginner-friendly
• Tokenize Xchange - Local exchange
• Binance - Global platform (advanced)

SECURITY STEPS:
1. VERIFY ACCOUNT: Use official Malaysian documents
2. ENABLE 2FA: Two-Factor Authentication is mandatory
3. SECURE EMAIL: Use dedicated email for crypto
4. SAFE STORAGE: For large amounts, use hardware wallet

HOW TO START:
1. Register account on chosen platform
2. Verify identity (MyKad)
3. Deposit RM50-100 to learn
4. Buy Bitcoin regularly (DCA - Dollar Cost Averaging)
5. Transfer to personal wallet if >RM1000

WARNINGS:
• Never share private keys
• Avoid unlicensed platforms
• Be careful of scams
• Store backup phrase safely

Start small, learn first! 🎓`;
    }
  }

  async buildContext(userId, message) {
    const user = await RedisService.getUser(userId);
    const recentTransactions = await this.getRecentTransactions(userId);
    const businessMetrics = await RedisService.getBusinessMetrics(userId);
    const aiHistory = await RedisService.getAIContext(userId);

    return {
      user_profile: {
        business_type: user.business_type || 'general',
        language: user.language || 'en',
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
    const prompt = `You are kheAI, an AI assistant for Malaysian microbusiness owners.

User Context:
- Business: ${context.user_profile.business_type}
- Language: ${context.user_profile.language}
- Name: ${context.user_profile.name}

Recent Business Activity:
${JSON.stringify(context.recent_transactions, null, 2)}

Business Metrics:
${JSON.stringify(context.business_metrics, null, 2)}

Current Query: ${message}

Guidelines:
- Provide practical business advice for Malaysian context
- For Bitcoin questions: focus on treasury management (2-5% allocation of profits)
- Consider Malaysian inflation rate (~3.5%) in recommendations
- Keep responses concise and actionable (under 200 words)
- Use simple language appropriate for microbusiness owners
- Always prioritize business cash flow over speculative investments
- Include specific RM amounts when giving advice
- Focus on practical next steps

Respond in ${context.user_profile.language === 'ms' ? 'Bahasa Malaysia' : 'English'}.`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('AI generation error:', error);
      return context.user_profile.language === 'ms' 
        ? 'Maaf, saya menghadapi masalah teknikal. Sila cuba lagi.'
        : 'Sorry, I\'m experiencing technical difficulties. Please try again.';
    }
  }

  async parseTransaction(message, userId) {
    const user = await RedisService.getUser(userId);
    
    const prompt = `Parse this Malaysian business transaction:
Message: "${message}"

Extract and return ONLY valid JSON:
{
  "amount": number,
  "type": "income|expense",
  "category": "inventory|rent|utilities|marketing|supplies|revenue|rental|other",
  "description": "clean description"
}

Transaction Type Detection Rules:
INCOME keywords: sales, income, received, dapat, terima, rental income, commission, payment received, cash in, revenue
EXPENSE keywords: beli, buy, bayar, pay, expense, cost, spend, purchase, paid

Category Detection Rules:
- inventory: inventory, stock, barang, goods, products
- rent: rent, sewa, rental (when it's expense)
- rental: rental income, sewa income (when it's income)
- utilities: electric, water, internet, phone, utilities, bill
- marketing: ads, marketing, promotion, iklan
- supplies: supplies, office, stationery
- revenue: sales, revenue, income (general business income)

Examples:
"Beli inventory RM150" → {"amount": 150, "type": "expense", "category": "inventory", "description": "Beli inventory"}
"Sales RM500" → {"amount": 500, "type": "income", "category": "revenue", "description": "Sales"}
"Rental income RM800" → {"amount": 800, "type": "income", "category": "rental", "description": "Rental income"}
"Received rental income RM800" → {"amount": 800, "type": "income", "category": "rental", "description": "Received rental income"}
"Rent payment RM800" → {"amount": 800, "type": "expense", "category": "rent", "description": "Rent payment"}
"Dapat commission RM200" → {"amount": 200, "type": "income", "category": "revenue", "description": "Commission received"}

Rules:
- amount must be a positive number
- type must be either "income" or "expense"
- description should be clean and descriptive
- If you cannot parse a valid transaction, return null`;

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

  // Fallback rule-based parsing
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
      
      // Clean description
      let description = message.trim();
      // Remove RM amount from description
      description = description.replace(/rm\s*\d+(?:\.\d{2})?/gi, '').trim();
      description = description.replace(/\d+(?:\.\d{2})?\s*rm/gi, '').trim();
      
      if (description.length < 3) {
        description = type === 'income' ? 'Income received' : 'Business expense';
      }
      
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

  async generateInsights(userId) {
    const metrics = await RedisService.getBusinessMetrics(userId);
    const user = await RedisService.getUser(userId);
    const transactions = await this.getRecentTransactions(userId);

    // Check if user has any data
    const hasData = transactions.length > 0 || 
                   parseFloat(metrics.total_revenue || 0) > 0 || 
                   parseFloat(metrics.total_expenses || 0) > 0;

    if (!hasData) {
      return user.language === 'ms' ? this.getWelcomeInsightsMalay() : this.getWelcomeInsightsEnglish();
    }

    const prompt = `Analyze this Malaysian microbusiness and provide 3 concise insights:

Business Profile: ${user.business_type}
Monthly Revenue: RM${metrics.total_revenue || 0}
Monthly Expenses: RM${metrics.total_expenses || 0}
Recent Transactions: ${transactions.length} transactions

Provide exactly 3 insights in this format:
1. [Insight title]: [2-3 sentences of actionable advice]
2. [Insight title]: [2-3 sentences of actionable advice]  
3. [Insight title]: [2-3 sentences of actionable advice]

Focus on: cash flow optimization, Bitcoin treasury (considering Malaysian inflation), and growth opportunities.
Keep each insight under 100 words. Use simple language.
Include specific RM amounts when possible.
Respond in ${user.language === 'ms' ? 'Bahasa Malaysia' : 'English'}.`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      return user.language === 'ms' 
        ? 'Tidak dapat menghasilkan insights pada masa ini.'
        : 'Unable to generate insights at the moment.';
    }
  }

  getWelcomeInsightsEnglish() {
    return `Welcome to kheAI! 🎉

Since you're just getting started, here are 3 key tips for Malaysian microbusinesses:

1. TRACK EVERYTHING: Record every ringgit in and out. Even small expenses add up. Use this bot to track: "Beli inventory RM50" or "Sales RM200"

2. INFLATION PROTECTION: With Malaysian inflation at ~3.5%, consider allocating 3-5% of profits to Bitcoin for long-term savings. Start small and learn first.

3. CASH FLOW IS KING: Keep at least 3 months of expenses as emergency fund. Focus on getting paid faster - offer early payment discounts to customers.

Try recording your first transaction now! 💪

Examples:
• "Sales RM500 today"
• "Rental income RM800"
• "Beli inventory RM150"`;
  }

  getWelcomeInsightsMalay() {
    return `Selamat datang ke kheAI! 🎉

Memandangkan anda baru bermula, berikut 3 tips penting untuk perniagaan kecil Malaysia:

1. REKOD SEMUA: Catat setiap ringgit masuk dan keluar. Perbelanjaan kecil pun boleh jadi besar. Guna bot ini: "Beli inventory RM50" atau "Sales RM200"

2. LINDUNGI DARI INFLASI: Dengan inflasi Malaysia ~3.5%, pertimbang 3-5% keuntungan untuk Bitcoin sebagai simpanan jangka panjang. Mula kecil dan belajar dulu.

3. ALIRAN TUNAI PENTING: Simpan sekurang-kurangnya 3 bulan perbelanjaan sebagai dana kecemasan. Fokus dapat bayaran cepat - beri diskaun bayaran awal kepada pelanggan.

Cuba rekod transaksi pertama anda sekarang! 💪

Contoh:
• "Sales RM500 hari ini"
• "Rental income RM800"
• "Beli inventory RM150"`;
  }
}

module.exports = new AIService();