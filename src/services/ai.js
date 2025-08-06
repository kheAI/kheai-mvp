const { GoogleGenerativeAI } = require('@google/generative-ai');
const { RedisService } = require('./redis');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class AIService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-pro' });
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
      const redis = require('../../config/redis');
      const txnIds = await redis.lRange(`user:${userId}:transactions`, 0, 4);
      
      const transactions = [];
      for (const txnId of txnIds) {
        const txn = await redis.json.get(`transaction:${txnId}`);
        if (txn) transactions.push(txn);
      }
      
      return transactions;
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

Provide helpful advice in ${context.user_profile.language === 'ms' ? 'Bahasa Malaysia' : 'English'}. 
Focus on practical business advice, Bitcoin treasury management for inflation protection, and Malaysian context.
Keep responses concise and actionable.`;

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
  "category": "inventory|rent|utilities|marketing|supplies|revenue|other",
  "description": "clean description"
}

If you cannot parse a valid transaction, return null.`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Validate required fields
        if (parsed.amount && parsed.type && parsed.description) {
          return parsed;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Transaction parsing error:', error);
      return null;
    }
  }

  async generateInsights(userId) {
    const metrics = await RedisService.getBusinessMetrics(userId);
    const user = await RedisService.getUser(userId);
    const transactions = await this.getRecentTransactions(userId);

    const prompt = `Analyze this Malaysian microbusiness and provide 3 key insights:

Business Profile: ${user.business_type}
Monthly Metrics: ${JSON.stringify(metrics)}
Recent Transactions: ${JSON.stringify(transactions)}

Focus on:
1. Cash flow optimization
2. Bitcoin treasury recommendations (considering Malaysian inflation)
3. Business growth opportunities

Respond in ${user.language === 'ms' ? 'Bahasa Malaysia' : 'English'} with actionable advice.`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      return user.language === 'ms' 
        ? 'Tidak dapat menghasilkan insights pada masa ini.'
        : 'Unable to generate insights at the moment.';
    }
  }
}

module.exports = new AIService();