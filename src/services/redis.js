const redis = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');

class RedisService {
  // User Management
  async createUser(telegramId, userData) {
    const userKey = `user:${telegramId}`;
    await redis.hSet(userKey, {
      id: telegramId,
      name: userData.name || 'Unknown',
      business_type: userData.business_type || 'general',
      language: userData.language || 'en',
      created_at: new Date().toISOString(),
      onboarding_complete: 'false'
    });
    return userKey;
  }

  async getUser(telegramId) {
    const userKey = `user:${telegramId}`;
    const user = await redis.hGetAll(userKey);
    return user;
  }

  // Transaction Management
  async createTransaction(userId, transactionData) {
    const txnId = uuidv4();
    const txnKey = `transaction:${txnId}`;
    
    const transaction = {
      id: txnId,
      user_id: userId,
      date: new Date().toISOString(),
      amount_myr: parseFloat(transactionData.amount),
      type: transactionData.type,
      category: transactionData.category,
      description: transactionData.description,
      double_entry: this.generateDoubleEntry(transactionData)
    };

    // Store transaction using RedisJSON
    await redis.json.set(txnKey, '$', transaction);
    
    // Add to user's transaction list
    await redis.lPush(`user:${userId}:transactions`, txnId);
    
    // Add to real-time stream
    await redis.xAdd('transactions', '*', {
      user_id: userId,
      transaction_id: txnId,
      amount: transaction.amount_myr.toString(),
      type: transaction.type,
      timestamp: Date.now().toString()
    });

    // Update business metrics
    await this.updateBusinessMetrics(userId, transaction);
    
    return transaction;
  }

  generateDoubleEntry(data) {
    const entries = {
      expense: {
        debit: this.getCategoryAccount(data.category),
        credit: 'cash_myr'
      },
      income: {
        debit: 'cash_myr',
        credit: 'revenue'
      }
    };
    return entries[data.type] || entries.expense;
  }

  getCategoryAccount(category) {
    const accounts = {
      inventory: 'inventory_asset',
      rent: 'rent_expense',
      utilities: 'utilities_expense',
      marketing: 'marketing_expense',
      supplies: 'supplies_expense'
    };
    return accounts[category] || 'general_expense';
  }

  // Business Metrics
  async updateBusinessMetrics(userId, transaction) {
    const metricsKey = `metrics:${userId}:${new Date().getMonth() + 1}`;
    
    if (transaction.type === 'income') {
      await redis.hIncrByFloat(metricsKey, 'total_revenue', transaction.amount_myr);
    } else {
      await redis.hIncrByFloat(metricsKey, 'total_expenses', transaction.amount_myr);
    }
    
    await redis.hIncrBy(metricsKey, 'transaction_count', 1);
    await redis.expire(metricsKey, 86400 * 365); // 1 year
  }

  async getBusinessMetrics(userId, month = null) {
    const currentMonth = month || (new Date().getMonth() + 1);
    const metricsKey = `metrics:${userId}:${currentMonth}`;
    return await redis.hGetAll(metricsKey);
  }

  // AI Context Management
  async storeAIContext(userId, message, response) {
    const contextKey = `ai_context:${userId}`;
    const context = {
      timestamp: Date.now(),
      user_message: message,
      ai_response: response
    };
    
    await redis.lPush(contextKey, JSON.stringify(context));
    await redis.lTrim(contextKey, 0, 9); // Keep last 10 interactions
  }

  async getAIContext(userId) {
    const contextKey = `ai_context:${userId}`;
    const contexts = await redis.lRange(contextKey, 0, -1);
    return contexts.map(ctx => JSON.parse(ctx));
  }

  // Search functionality
  async searchTransactions(userId, query) {
    try {
      const results = await redis.ft.search('transactions_idx', 
        `@user_id:${userId} @description:${query}*`,
        { LIMIT: { from: 0, size: 10 } }
      );
      return results;
    } catch (error) {
      console.error('Search error:', error);
      return { documents: [] };
    }
  }

  // AI Response Caching
  async getCachedAIResponse(query, userId) {
    const queryHash = require('crypto').createHash('md5').update(query + userId).digest('hex');
    const cacheKey = `ai_cache:${queryHash}`;
    
    const cached = await redis.get(cacheKey);
    if (cached) {
      await redis.incr(`cache_hits:${userId}`);
      return JSON.parse(cached);
    }
    return null;
  }

  async cacheAIResponse(query, userId, response) {
    const queryHash = require('crypto').createHash('md5').update(query + userId).digest('hex');
    const cacheKey = `ai_cache:${queryHash}`;
    
    await redis.setEx(cacheKey, 3600, JSON.stringify(response)); // Cache for 1 hour
  }
}

// Create search indexes
async function createSearchIndexes() {
  try {
    await redis.ft.create('transactions_idx', {
      '$.user_id': { type: 'NUMERIC', AS: 'user_id' },
      '$.description': { type: 'TEXT', AS: 'description' },
      '$.category': { type: 'TAG', AS: 'category' },
      '$.amount_myr': { type: 'NUMERIC', AS: 'amount' },
      '$.type': { type: 'TAG', AS: 'type' }
    }, { ON: 'JSON', PREFIX: 'transaction:' });
    
    console.log('✅ Search indexes created');
  } catch (error) {
    if (error.message.includes('Index already exists')) {
      console.log('✅ Search indexes already exist');
    } else {
      console.error('❌ Error creating search indexes:', error);
    }
  }
}

module.exports = { RedisService: new RedisService(), createSearchIndexes };