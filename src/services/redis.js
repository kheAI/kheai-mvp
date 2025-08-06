const redis = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');

class RedisService {
  // User Management
  async createUser(telegramId, userData) {
    const userKey = `user:${telegramId}`;
    await redis.hSet(userKey, {
      id: telegramId.toString(),
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
      user_id: userId.toString(),
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
    
    // Add to real-time stream - ALL VALUES MUST BE STRINGS
    await redis.xAdd('transactions', '*', {
      user_id: userId.toString(),
      transaction_id: txnId.toString(),
      amount: transaction.amount_myr.toString(),
      type: transaction.type.toString(),
      category: transaction.category.toString(),
      timestamp: Date.now().toString()
    });

    // Update business metrics
    await this.updateBusinessMetrics(userId, transaction);
    
    return transaction;
  }

  // Transaction Deletion
  async deleteTransaction(userId, transactionId) {
    try {
      const txnKey = `transaction:${transactionId}`;
      
      // Get transaction details before deletion
      const transaction = await redis.json.get(txnKey);
      
      if (!transaction || transaction.user_id !== userId.toString()) {
        return { success: false, error: 'Transaction not found or unauthorized' };
      }
      
      // Remove from RedisJSON
      await redis.del(txnKey);
      
      // Remove from user's transaction list
      await redis.lRem(`user:${userId}:transactions`, 1, transactionId);
      
      // Reverse the business metrics
      await this.reverseBusinessMetrics(userId, transaction);
      
      // Add deletion record to stream
      await redis.xAdd('transaction_deletions', '*', {
        user_id: userId.toString(),
        transaction_id: transactionId.toString(),
        amount: transaction.amount_myr.toString(),
        type: transaction.type.toString(),
        deleted_at: Date.now().toString()
      });
      
      return { success: true, transaction };
      
    } catch (error) {
      console.error('Delete transaction error:', error);
      return { success: false, error: 'Failed to delete transaction' };
    }
  }

  async reverseBusinessMetrics(userId, transaction) {
    const metricsKey = `metrics:${userId.toString()}:${new Date().getMonth() + 1}`;
    
    if (transaction.type === 'income') {
      await redis.hIncrByFloat(metricsKey, 'total_revenue', -transaction.amount_myr);
    } else {
      await redis.hIncrByFloat(metricsKey, 'total_expenses', -transaction.amount_myr);
    }
    
    await redis.hIncrBy(metricsKey, 'transaction_count', -1);
  }

  async getRecentTransactions(userId, limit = 10) {
    try {
      const txnIds = await redis.lRange(`user:${userId}:transactions`, 0, limit * 2); // Get more to account for deleted ones
      const transactions = [];
      
      for (const txnId of txnIds) {
        try {
          const txn = await redis.json.get(`transaction:${txnId}`);
          if (txn) {
            transactions.push(txn);
            if (transactions.length >= limit) break; // Stop when we have enough valid transactions
          } else {
            // Remove invalid transaction ID from the list
            await redis.lRem(`user:${userId}:transactions`, 1, txnId);
          }
        } catch (error) {
          // Transaction doesn't exist, remove from list
          await redis.lRem(`user:${userId}:transactions`, 1, txnId);
        }
      }
      
      // Sort by date (newest first)
      transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      return transactions.slice(0, limit);
    } catch (error) {
      console.error('Error getting recent transactions:', error);
      return [];
    }
  }

  // Find all transactions for a user (even if not in the list)
  async findAllUserTransactions(userId) {
    try {
      const allTransactionKeys = await redis.keys('transaction:*');
      const userTransactions = [];
      
      for (const key of allTransactionKeys) {
        try {
          const txn = await redis.json.get(key);
          if (txn && txn.user_id === userId.toString()) {
            userTransactions.push(txn);
          }
        } catch (error) {
          // Skip invalid transactions
        }
      }
      
      // Sort by date (newest first)
      userTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      return userTransactions;
    } catch (error) {
      console.error('Find all transactions error:', error);
      return [];
    }
  }

  // Rebuild user transaction list from all found transactions
  async rebuildTransactionList(userId) {
    try {
      const allTransactions = await this.findAllUserTransactions(userId);
      
      // Clear existing list
      const listKey = `user:${userId}:transactions`;
      await redis.del(listKey);
      
      // Rebuild list with all found transactions
      if (allTransactions.length > 0) {
        const txnIds = allTransactions.map(txn => txn.id);
        await redis.lPush(listKey, ...txnIds.reverse()); // Reverse to maintain chronological order
      }
      
      console.log(`✅ Rebuilt transaction list for user ${userId}: ${allTransactions.length} transactions`);
      return allTransactions;
    } catch (error) {
      console.error('Rebuild transaction list error:', error);
      return [];
    }
  }

  // Reconcile business metrics with actual transactions
  async reconcileBusinessMetrics(userId) {
    try {
      console.log(`🔄 Starting reconciliation for user ${userId}`);
      
      // Get all valid transactions
      const allTransactions = await this.findAllUserTransactions(userId);
      
      // Recalculate metrics from scratch
      const currentMonth = new Date().getMonth() + 1;
      const metricsKey = `metrics:${userId.toString()}:${currentMonth}`;
      
      // Reset metrics
      await redis.del(metricsKey);
      
      let totalRevenue = 0;
      let totalExpenses = 0;
      let transactionCount = 0;
      
      // Recalculate from valid transactions
      allTransactions.forEach(txn => {
        if (txn.type === 'income') {
          totalRevenue += txn.amount_myr;
        } else {
          totalExpenses += txn.amount_myr;
        }
        transactionCount++;
      });
      
      // Set correct metrics
      if (totalRevenue > 0) {
        await redis.hSet(metricsKey, 'total_revenue', totalRevenue.toString());
      }
      if (totalExpenses > 0) {
        await redis.hSet(metricsKey, 'total_expenses', totalExpenses.toString());
      }
      if (transactionCount > 0) {
        await redis.hSet(metricsKey, 'transaction_count', transactionCount.toString());
      }
      
      await redis.expire(metricsKey, 86400 * 365); // 1 year
      
      console.log(`✅ Reconciliation complete for user ${userId}:`);
      console.log(`   Valid transactions: ${transactionCount}`);
      console.log(`   Total revenue: RM${totalRevenue}`);
      console.log(`   Total expenses: RM${totalExpenses}`);
      
      return {
        validTransactions: transactionCount,
        totalRevenue,
        totalExpenses,
        fixedTransactions: allTransactions
      };
      
    } catch (error) {
      console.error('Reconciliation error:', error);
      throw error;
    }
  }

  // Cleanup invalid transaction references
  async cleanupTransactionList(userId) {
    try {
      const txnIds = await redis.lRange(`user:${userId}:transactions`, 0, -1);
      const validTxnIds = [];
      
      for (const txnId of txnIds) {
        try {
          const txn = await redis.json.get(`transaction:${txnId}`);
          if (txn) {
            validTxnIds.push(txnId);
          }
        } catch (error) {
          // Transaction doesn't exist, skip it
        }
      }
      
      // Rebuild the transaction list with only valid IDs
      const listKey = `user:${userId}:transactions`;
      await redis.del(listKey);
      
      if (validTxnIds.length > 0) {
        await redis.lPush(listKey, ...validTxnIds.reverse()); // Reverse to maintain order
      }
      
      console.log(`✅ Cleaned up transaction list for user ${userId}: ${validTxnIds.length} valid transactions`);
      return validTxnIds.length;
    } catch (error) {
      console.error('Cleanup error:', error);
      return 0;
    }
  }

  generateDoubleEntry(data) {
    if (data.type === 'income') {
      return {
        debit: 'cash_myr',
        credit: this.getCategoryAccount(data.category)
      };
    } else {
      return {
        debit: this.getCategoryAccount(data.category),
        credit: 'cash_myr'
      };
    }
  }

  getCategoryAccount(category) {
    const accounts = {
      // Expense accounts
      inventory: 'inventory_asset',
      rent: 'rent_expense',
      utilities: 'utilities_expense',
      marketing: 'marketing_expense',
      supplies: 'supplies_expense',
      other: 'general_expense',
      
      // Income accounts  
      revenue: 'revenue',
      rental: 'rental_income',
      commission: 'commission_income'
    };
    return accounts[category] || 'general_expense';
  }

  // Business Metrics
  async updateBusinessMetrics(userId, transaction) {
    const metricsKey = `metrics:${userId.toString()}:${new Date().getMonth() + 1}`;
    
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
    const metricsKey = `metrics:${userId.toString()}:${currentMonth}`;
    return await redis.hGetAll(metricsKey);
  }

  // AI Context Management
  async storeAIContext(userId, message, response) {
    const contextKey = `ai_context:${userId.toString()}`;
    const context = {
      timestamp: Date.now(),
      user_message: message,
      ai_response: response
    };
    
    await redis.lPush(contextKey, JSON.stringify(context));
    await redis.lTrim(contextKey, 0, 9); // Keep last 10 interactions
  }

  async getAIContext(userId) {
    const contextKey = `ai_context:${userId.toString()}`;
    const contexts = await redis.lRange(contextKey, 0, -1);
    return contexts.map(ctx => JSON.parse(ctx));
  }

  // Search functionality
  async searchTransactions(userId, query) {
    try {
      const results = await redis.ft.search('transactions_idx', 
        `@user_id:${userId.toString()} @description:${query}*`,
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
    const queryHash = require('crypto').createHash('md5').update(query + userId.toString()).digest('hex');
    const cacheKey = `ai_cache:${queryHash}`;
    
    const cached = await redis.get(cacheKey);
    if (cached) {
      await redis.incr(`cache_hits:${userId.toString()}`);
      return JSON.parse(cached);
    }
    return null;
  }

  async cacheAIResponse(query, userId, response) {
    const queryHash = require('crypto').createHash('md5').update(query + userId.toString()).digest('hex');
    const cacheKey = `ai_cache:${queryHash}`;
    
    await redis.setEx(cacheKey, 3600, JSON.stringify(response)); // Cache for 1 hour
  }

  // Export functionality (Fixed)
  async exportTransactions(userId, format = 'csv') {
    try {
      // Use findAllUserTransactions to get ALL transactions
      const transactions = await this.findAllUserTransactions(userId);
      
      if (format === 'csv') {
        let csv = 'Date,Type,Category,Description,Amount (MYR),Debit Account,Credit Account\n';
        
        // Sort transactions by date (newest first)
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        transactions.forEach(txn => {
          const date = new Date(txn.date).toLocaleDateString();
          const description = txn.description.replace(/"/g, '""'); // Escape quotes
          csv += `${date},${txn.type},${txn.category},"${description}",${txn.amount_myr},${txn.double_entry.debit},${txn.double_entry.credit}\n`;
        });
        
        return csv;
      }
      
      return transactions;
    } catch (error) {
      console.error('Export error:', error);
      return null;
    }
  }
}

// Create search indexes
async function createSearchIndexes() {
  try {
    await redis.ft.create('transactions_idx', {
      '$.user_id': { type: 'TEXT', AS: 'user_id' },
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

