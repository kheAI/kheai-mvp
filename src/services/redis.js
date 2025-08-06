// src/services/redis.js

const redis = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');

class RedisService {
  // User Management
  async createUser(telegramId, userData) {
    try {
      const userKey = `user:${telegramId}`;
      await redis.hSet(userKey, {
        id: telegramId.toString(),
        name: userData.name || 'Unknown',
        business_type: userData.business_type || 'general',
        language: userData.language || 'en',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        onboarding_complete: userData.onboarding_complete || 'false'
      });
      
      // Add to users index
      await redis.sAdd('all_users', telegramId.toString());
      
      console.log(`✅ Created user: ${telegramId}`);
      return userKey;
    } catch (error) {
      console.error('Create user error:', error);
      throw error;
    }
  }

  async getUser(telegramId) {
    try {
      const userKey = `user:${telegramId}`;
      const user = await redis.hGetAll(userKey);
      return user;
    } catch (error) {
      console.error('Get user error:', error);
      return {};
    }
  }

  async updateUser(telegramId, updates) {
    try {
      const userKey = `user:${telegramId}`;
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString()
      };
      
      await redis.hSet(userKey, updateData);
      return true;
    } catch (error) {
      console.error('Update user error:', error);
      return false;
    }
  }

  // User State Management
  async setUserState(userId, state, data = null) {
    try {
      const stateKey = `user_state:${userId.toString()}`;
      const stateData = {
        state: state,
        data: data,
        timestamp: Date.now()
      };
      
      await redis.setEx(stateKey, 3600, JSON.stringify(stateData)); // Expire in 1 hour
      return true;
    } catch (error) {
      console.error('Set user state error:', error);
      return false;
    }
  }

  async getUserState(userId) {
    try {
      const stateKey = `user_state:${userId.toString()}`;
      const stateData = await redis.get(stateKey);
      
      if (stateData) {
        const parsed = JSON.parse(stateData);
        // Check if state is not too old (1 hour)
        if (Date.now() - parsed.timestamp < 3600000) {
          return parsed;
        } else {
          // Clean up expired state
          await this.clearUserState(userId);
          return null;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Get user state error:', error);
      return null;
    }
  }

  async clearUserState(userId) {
    try {
      const stateKey = `user_state:${userId.toString()}`;
      await redis.del(stateKey);
      return true;
    } catch (error) {
      console.error('Clear user state error:', error);
      return false;
    }
  }

  // Transaction Management
  async createTransaction(userId, transactionData) {
    try {
      const txnId = uuidv4();
      const txnKey = `transaction:${txnId}`;
      
      const transaction = {
        id: txnId,
        user_id: userId.toString(),
        date: transactionData.date || new Date().toISOString(),
        amount_myr: parseFloat(transactionData.amount),
        type: transactionData.type,
        category: transactionData.category,
        description: transactionData.description,
        is_future: transactionData.is_future || false,
        double_entry: this.generateDoubleEntry(transactionData),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
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
        is_future: transaction.is_future.toString(),
        timestamp: Date.now().toString()
      });

      // Update business metrics (only for current transactions)
      if (!transaction.is_future || new Date(transaction.date) <= new Date()) {
        await this.updateBusinessMetrics(userId, transaction);
      }
      
      console.log(`✅ Created transaction: ${txnId} for user ${userId}`);
      return transaction;
    } catch (error) {
      console.error('Create transaction error:', error);
      throw error;
    }
  }

  async getTransaction(transactionId) {
    try {
      const txnKey = `transaction:${transactionId}`;
      const transaction = await redis.json.get(txnKey);
      return transaction;
    } catch (error) {
      console.error('Get transaction error:', error);
      return null;
    }
  }

  // Enhanced transaction editing
  async editTransaction(userId, transactionId, updates) {
    const txnKey = `transaction:${transactionId}`;
    
    try {
      const transaction = await redis.json.get(txnKey);
      
      if (!transaction || transaction.user_id !== userId.toString()) {
        return { success: false, error: 'Transaction not found or unauthorized' };
      }

      // Store original for metrics reversal
      const original = { ...transaction };
      
      // Update transaction
      const updatedTransaction = {
        ...transaction,
        ...updates,
        updated_at: new Date().toISOString()
      };

      await redis.json.set(txnKey, '$', updatedTransaction);
      
      // Update metrics (reverse old, apply new) - only for current transactions
      if (!original.is_future || new Date(original.date) <= new Date()) {
        await this.reverseBusinessMetrics(userId, original);
      }
      if (!updatedTransaction.is_future || new Date(updatedTransaction.date) <= new Date()) {
        await this.updateBusinessMetrics(userId, updatedTransaction);
      }
      
      // Add to update stream
      await redis.xAdd('transactions_updated', '*', {
        user_id: userId.toString(),
        transaction_id: transactionId.toString(),
        updated_fields: JSON.stringify(Object.keys(updates)),
        timestamp: Date.now().toString()
      });
      
      console.log(`✅ Updated transaction: ${transactionId} for user ${userId}`);
      return { success: true, transaction: updatedTransaction };
    } catch (error) {
      console.error('Edit transaction error:', error);
      return { success: false, error: 'Failed to edit transaction' };
    }
  }

  // Future transaction support
  async createFutureTransaction(userId, transactionData, futureDate) {
    try {
      const transaction = await this.createTransaction(userId, {
        ...transactionData,
        date: futureDate,
        is_future: true
      });

      // Don't update current metrics for future transactions
      if (new Date(futureDate) > new Date()) {
        await this.reverseBusinessMetrics(userId, transaction);
      }

      return transaction;
    } catch (error) {
      console.error('Create future transaction error:', error);
      throw error;
    }
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
      
      // Reverse the business metrics (only for current transactions)
      if (!transaction.is_future || new Date(transaction.date) <= new Date()) {
        await this.reverseBusinessMetrics(userId, transaction);
      }
      
      // Add deletion record to stream
      await redis.xAdd('transaction_deletions', '*', {
        user_id: userId.toString(),
        transaction_id: transactionId.toString(),
        amount: transaction.amount_myr.toString(),
        type: transaction.type.toString(),
        deleted_at: Date.now().toString()
      });
      
      console.log(`✅ Deleted transaction: ${transactionId} for user ${userId}`);
      return { success: true, transaction };
      
    } catch (error) {
      console.error('Delete transaction error:', error);
      return { success: false, error: 'Failed to delete transaction' };
    }
  }

  async reverseBusinessMetrics(userId, transaction) {
    try {
      const metricsKey = `metrics:${userId.toString()}:${new Date(transaction.date).getMonth() + 1}`;
      
      if (transaction.type === 'income') {
        await redis.hIncrByFloat(metricsKey, 'total_revenue', -transaction.amount_myr);
      } else {
        await redis.hIncrByFloat(metricsKey, 'total_expenses', -transaction.amount_myr);
      }
      
      await redis.hIncrBy(metricsKey, 'transaction_count', -1);
    } catch (error) {
      console.error('Reverse business metrics error:', error);
    }
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
      // FIXED: Use consistent key format
      const metricsKey = `metrics:${userId.toString()}:${currentMonth}`;
      
      // Reset metrics
      await redis.del(metricsKey);
      
      let totalRevenue = 0;
      let totalExpenses = 0;
      let transactionCount = 0;
      
      // Recalculate from valid transactions (only current, not future)
      allTransactions.forEach(txn => {
        const txnDate = new Date(txn.date);
        const txnMonth = txnDate.getMonth() + 1;
        
        // Only count transactions from current month
        if (txnMonth === currentMonth && (!txn.is_future || new Date(txn.date) <= new Date())) {
          if (txn.type === 'income') {
            totalRevenue += txn.amount_myr;
          } else {
            totalExpenses += txn.amount_myr;
          }
          transactionCount++;
        }
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
      
      await redis.hSet(metricsKey, 'last_updated', new Date().toISOString());
      await redis.expire(metricsKey, 86400 * 365); // 1 year
      
      console.log(`✅ Reconciliation complete for user ${userId}:`);
      console.log(`   Valid transactions: ${transactionCount}`);
      console.log(`   Total revenue: RM${totalRevenue}`);
      console.log(`   Total expenses: RM${totalExpenses}`);
      console.log(`   Metrics key: ${metricsKey}`);
      
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
    try {
      const transactionDate = new Date(transaction.date);
      const month = transactionDate.getMonth() + 1;
      const year = transactionDate.getFullYear();
      // FIXED: Use consistent key format
      const metricsKey = `metrics:${userId.toString()}:${month}`;
      
      if (transaction.type === 'income') {
        await redis.hIncrByFloat(metricsKey, 'total_revenue', transaction.amount_myr);
      } else {
        await redis.hIncrByFloat(metricsKey, 'total_expenses', transaction.amount_myr);
      }
      
      await redis.hIncrBy(metricsKey, 'transaction_count', 1);
      await redis.hSet(metricsKey, 'last_updated', new Date().toISOString());
      await redis.expire(metricsKey, 86400 * 365); // 1 year
    } catch (error) {
      console.error('Update business metrics error:', error);
    }
  }

  async getBusinessMetrics(userId, month = null, year = null) {
    try {
      const currentDate = new Date();
      const targetMonth = month || (currentDate.getMonth() + 1);
      // FIXED: Use same key format as updateBusinessMetrics
      const metricsKey = `metrics:${userId.toString()}:${targetMonth}`;
      
      const metrics = await redis.hGetAll(metricsKey);
      
      // Ensure numeric values
      return {
        total_revenue: parseFloat(metrics.total_revenue || 0),
        total_expenses: parseFloat(metrics.total_expenses || 0),
        transaction_count: parseInt(metrics.transaction_count || 0),
        last_updated: metrics.last_updated || null
      };
    } catch (error) {
      console.error('Get business metrics error:', error);
      return {
        total_revenue: 0,
        total_expenses: 0,
        transaction_count: 0,
        last_updated: null
      };
    }
  }

  async getBusinessMetricsRange(userId, startMonth, startYear, endMonth, endYear) {
    try {
      const metrics = [];
      let currentMonth = startMonth;
      let currentYear = startYear;
      
      while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
        const monthMetrics = await this.getBusinessMetrics(userId, currentMonth, currentYear);
        metrics.push({
          month: currentMonth,
          year: currentYear,
          ...monthMetrics
        });
        
        currentMonth++;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear++;
        }
      }
      
      return metrics;
    } catch (error) {
      console.error('Get business metrics range error:', error);
      return [];
    }
  }

  // AI Context Management
  async storeAIContext(userId, message, response) {
    try {
      const contextKey = `ai_context:${userId.toString()}`;
      const context = {
        timestamp: Date.now(),
        user_message: message,
        ai_response: response
      };
      
      await redis.lPush(contextKey, JSON.stringify(context));
      await redis.lTrim(contextKey, 0, 9); // Keep last 10 interactions
      await redis.expire(contextKey, 86400 * 7); // 7 days
    } catch (error) {
      console.error('Store AI context error:', error);
    }
  }

  async getAIContext(userId) {
    try {
      const contextKey = `ai_context:${userId.toString()}`;
      const contexts = await redis.lRange(contextKey, 0, -1);
      return contexts.map(ctx => JSON.parse(ctx));
    } catch (error) {
      console.error('Get AI context error:', error);
      return [];
    }
  }

  // Enhanced search functionality
  async searchTransactions(userId, query) {
    try {
      let searchQuery;
      const baseFilter = `@user_id:${userId.toString()}`;
      
      // Detect search type and build appropriate query
      if (query.match(/^rm\s*\d+/i) || query.match(/^\d+/)) {
        // Amount search: "RM800" or "800"
        const amount = query.replace(/rm\s*/i, '').replace(/[^\d.]/g, '');
        if (amount) {
          searchQuery = `${baseFilter} @amount:[${amount} ${amount}]`;
        }
      } else if (['inventory', 'rent', 'utilities', 'marketing', 'supplies', 'revenue', 'rental', 'other'].includes(query.toLowerCase())) {
        // Category search: exact match
        searchQuery = `${baseFilter} @category:{${query.toLowerCase()}}`;
      } else {
        // Description search: fuzzy text search
        searchQuery = `${baseFilter} @description:*${query}*`;
      }
      
      console.log('Search query:', searchQuery); // Debug log
      
      const results = await redis.ft.search('transactions_idx', searchQuery, {
        LIMIT: { from: 0, size: 20 },
        SORTBY: { BY: 'amount', DIRECTION: 'DESC' }
      });
      
      return results;
    } catch (error) {
      console.error('Search error:', error);
      
      // Fallback: manual search through user's transactions
      return await this.fallbackSearch(userId, query);
    }
  }

  // Fallback search when RedisSearch fails
  async fallbackSearch(userId, query) {
    try {
      const allTransactions = await this.findAllUserTransactions(userId);
      const lowerQuery = query.toLowerCase();
      
      const matchedTransactions = allTransactions.filter(txn => {
        // Amount search
        if (query.match(/^rm\s*\d+/i) || query.match(/^\d+/)) {
          const searchAmount = parseFloat(query.replace(/rm\s*/i, '').replace(/[^\d.]/g, ''));
          return Math.abs(txn.amount_myr - searchAmount) < 0.01;
        }
        
        // Category search
        if (txn.category && txn.category.toLowerCase().includes(lowerQuery)) {
          return true;
        }
        
        // Description search
        if (txn.description && txn.description.toLowerCase().includes(lowerQuery)) {
          return true;
        }
        
        // Type search
        if (txn.type && txn.type.toLowerCase().includes(lowerQuery)) {
          return true;
        }
        
        return false;
      });
      
      // Format to match RedisSearch response structure
      return {
        total: matchedTransactions.length,
        documents: matchedTransactions.map(txn => ({
          id: `transaction:${txn.id}`,
          value: txn
        }))
      };
    } catch (error) {
      console.error('Fallback search error:', error);
      return { documents: [] };
    }
  }

  // AI Response Caching
  async getCachedAIResponse(query, userId) {
    try {
      const queryHash = require('crypto').createHash('md5').update(query + userId.toString()).digest('hex');
      const cacheKey = `ai_cache:${queryHash}`;
      
      const cached = await redis.get(cacheKey);
      if (cached) {
        await redis.incr(`cache_hits:${userId.toString()}`);
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error('Get cached AI response error:', error);
      return null;
    }
  }

  async cacheAIResponse(query, userId, response) {
    try {
      const queryHash = require('crypto').createHash('md5').update(query + userId.toString()).digest('hex');
      const cacheKey = `ai_cache:${queryHash}`;
      
      await redis.setEx(cacheKey, 3600, JSON.stringify(response)); // Cache for 1 hour
    } catch (error) {
      console.error('Cache AI response error:', error);
    }
  }

  // Export functionality (Fixed)
  async exportTransactions(userId, format = 'csv') {
    try {
      // Use findAllUserTransactions to get ALL transactions
      const transactions = await this.findAllUserTransactions(userId);
      
      if (format === 'csv') {
        let csv = 'Date,Type,Category,Description,Amount (MYR),Is Future,Debit Account,Credit Account,Created At\n';
        
        // Sort transactions by date (newest first)
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        transactions.forEach(txn => {
          const date = new Date(txn.date).toLocaleDateString();
          const createdAt = new Date(txn.created_at).toLocaleDateString();
          const description = txn.description.replace(/"/g, '""'); // Escape quotes
          const isFuture = txn.is_future ? 'Yes' : 'No';
          
          csv += `${date},${txn.type},${txn.category},"${description}",${txn.amount_myr},${isFuture},${txn.double_entry.debit},${txn.double_entry.credit},${createdAt}\n`;
        });
        
        return csv;
      }
      
      return transactions;
    } catch (error) {
      console.error('Export error:', error);
      return null;
    }
  }

  // Analytics and Reporting
  async getUserAnalytics(userId) {
    try {
      const transactions = await this.findAllUserTransactions(userId);
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();
      
      // Current month metrics
      const currentMetrics = await this.getBusinessMetrics(userId, currentMonth, currentYear);
      
      // Previous month metrics
      let prevMonth = currentMonth - 1;
      let prevYear = currentYear;
      if (prevMonth === 0) {
        prevMonth = 12;
        prevYear = currentYear - 1;
      }
      const previousMetrics = await this.getBusinessMetrics(userId, prevMonth, prevYear);
      
      // Calculate growth
      const revenueGrowth = previousMetrics.total_revenue > 0 ? 
        ((currentMetrics.total_revenue - previousMetrics.total_revenue) / previousMetrics.total_revenue) * 100 : 0;
      
      const expenseGrowth = previousMetrics.total_expenses > 0 ? 
        ((currentMetrics.total_expenses - previousMetrics.total_expenses) / previousMetrics.total_expenses) * 100 : 0;
      
      // Category breakdown
      const categoryBreakdown = {};
      transactions.forEach(txn => {
        if (!categoryBreakdown[txn.category]) {
          categoryBreakdown[txn.category] = { income: 0, expenses: 0, count: 0 };
        }
        
        if (txn.type === 'income') {
          categoryBreakdown[txn.category].income += txn.amount_myr;
        } else {
          categoryBreakdown[txn.category].expenses += txn.amount_myr;
        }
        categoryBreakdown[txn.category].count++;
      });
      
      return {
        current_month: currentMetrics,
        previous_month: previousMetrics,
        growth: {
          revenue: revenueGrowth,
          expenses: expenseGrowth
        },
        category_breakdown: categoryBreakdown,
        total_transactions: transactions.length,
        avg_transaction_amount: transactions.length > 0 ? 
          transactions.reduce((sum, txn) => sum + txn.amount_myr, 0) / transactions.length : 0
      };
    } catch (error) {
      console.error('Get user analytics error:', error);
      return null;
    }
  }

  // Data integrity and maintenance
  async performDataIntegrityCheck(userId) {
    try {
      console.log(`🔍 Starting data integrity check for user ${userId}`);
      
      const issues = [];
      
      // Check transaction list integrity
      const listTransactions = await redis.lRange(`user:${userId}:transactions`, 0, -1);
      const actualTransactions = await this.findAllUserTransactions(userId);
      
      if (listTransactions.length !== actualTransactions.length) {
        issues.push({
          type: 'transaction_list_mismatch',
          description: `Transaction list has ${listTransactions.length} entries but found ${actualTransactions.length} actual transactions`,
          severity: 'medium'
        });
      }
      
      // Check for orphaned transactions
      const orphanedTransactions = actualTransactions.filter(txn => 
        !listTransactions.includes(txn.id)
      );
      
      if (orphanedTransactions.length > 0) {
        issues.push({
          type: 'orphaned_transactions',
          description: `Found ${orphanedTransactions.length} transactions not in user's transaction list`,
          severity: 'high',
          data: orphanedTransactions.map(txn => txn.id)
        });
      }
      
      // Check metrics consistency
      const calculatedMetrics = await this.reconcileBusinessMetrics(userId);
      const storedMetrics = await this.getBusinessMetrics(userId);
      
      if (Math.abs(calculatedMetrics.totalRevenue - storedMetrics.total_revenue) > 0.01) {
        issues.push({
          type: 'revenue_mismatch',
          description: `Stored revenue (${storedMetrics.total_revenue}) doesn't match calculated (${calculatedMetrics.totalRevenue})`,
          severity: 'high'
        });
      }
      
      if (Math.abs(calculatedMetrics.totalExpenses - storedMetrics.total_expenses) > 0.01) {
        issues.push({
          type: 'expenses_mismatch',
          description: `Stored expenses (${storedMetrics.total_expenses}) doesn't match calculated (${calculatedMetrics.totalExpenses})`,
          severity: 'high'
        });
      }
      
      console.log(`✅ Data integrity check complete for user ${userId}: ${issues.length} issues found`);
      
      return {
        user_id: userId,
        check_timestamp: new Date().toISOString(),
        issues_found: issues.length,
        issues: issues,
        recommendations: this.generateIntegrityRecommendations(issues)
      };
    } catch (error) {
      console.error('Data integrity check error:', error);
      return {
        user_id: userId,
        check_timestamp: new Date().toISOString(),
        issues_found: -1,
        error: error.message
      };
    }
  }

  generateIntegrityRecommendations(issues) {
    const recommendations = [];
    
    if (issues.some(issue => issue.type === 'transaction_list_mismatch' || issue.type === 'orphaned_transactions')) {
      recommendations.push('Run /recover command to rebuild transaction lists');
    }
    
    if (issues.some(issue => issue.type === 'revenue_mismatch' || issue.type === 'expenses_mismatch')) {
      recommendations.push('Run metrics reconciliation to fix calculation discrepancies');
    }
    
    if (issues.length === 0) {
      recommendations.push('Data integrity is good - no action needed');
    }
    
    return recommendations;
  }

  // Bulk operations
  async bulkCreateTransactions(userId, transactionsData) {
    try {
      const createdTransactions = [];
      const errors = [];
      
      for (let i = 0; i < transactionsData.length; i++) {
        try {
          const transaction = await this.createTransaction(userId, transactionsData[i]);
          createdTransactions.push(transaction);
        } catch (error) {
          errors.push({
            index: i,
            data: transactionsData[i],
            error: error.message
          });
        }
      }
      
      return {
        success: createdTransactions.length,
        errors: errors.length,
        created_transactions: createdTransactions,
        failed_transactions: errors
      };
    } catch (error) {
      console.error('Bulk create transactions error:', error);
      throw error;
    }
  }

  async bulkDeleteTransactions(userId, transactionIds) {
    try {
      const deletedTransactions = [];
      const errors = [];
      
      for (const transactionId of transactionIds) {
        try {
          const result = await this.deleteTransaction(userId, transactionId);
          if (result.success) {
            deletedTransactions.push(result.transaction);
          } else {
            errors.push({
              transaction_id: transactionId,
              error: result.error
            });
          }
        } catch (error) {
          errors.push({
            transaction_id: transactionId,
            error: error.message
          });
        }
      }
      
      return {
        success: deletedTransactions.length,
        errors: errors.length,
        deleted_transactions: deletedTransactions,
        failed_deletions: errors
      };
    } catch (error) {
      console.error('Bulk delete transactions error:', error);
      throw error;
    }
  }

  // System maintenance
  async cleanupExpiredData() {
    try {
      let cleanedCount = 0;
      
      // Clean up expired user states
      const userStateKeys = await redis.keys('user_state:*');
      for (const key of userStateKeys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) { // No expiration set
          await redis.expire(key, 3600); // Set 1 hour expiration
        }
      }
      
      // Clean up old AI cache entries
      const aiCacheKeys = await redis.keys('ai_cache:*');
      for (const key of aiCacheKeys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) { // No expiration set
          await redis.expire(key, 3600); // Set 1 hour expiration
          cleanedCount++;
        }
      }
      
      // Clean up old streams (keep last 1000 entries)
      const streams = ['transactions', 'transaction_deletions', 'transactions_updated'];
      for (const stream of streams) {
        try {
          const length = await redis.xLen(stream);
          if (length > 1000) {
            await redis.xTrim(stream, 'MAXLEN', '~', 1000);
            cleanedCount++;
          }
        } catch (error) {
          // Stream might not exist
        }
      }
      
      console.log(`✅ Cleanup completed: ${cleanedCount} items processed`);
      return cleanedCount;
    } catch (error) {
      console.error('Cleanup expired data error:', error);
      return 0;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const start = Date.now();
      
      // Test basic operations
      await redis.ping();
      const testKey = `health_check_${Date.now()}`;
      await redis.set(testKey, 'test');
      const testValue = await redis.get(testKey);
      await redis.del(testKey);
      
      const responseTime = Date.now() - start;
      
      // Get system info
      const info = await redis.info();
      const memory = await redis.info('memory');
      
      return {
        status: 'healthy',
        response_time_ms: responseTime,
        redis_connected: testValue === 'test',
        timestamp: new Date().toISOString(),
        redis_info: {
          version: this.extractInfoValue(info, 'redis_version'),
          uptime: this.extractInfoValue(info, 'uptime_in_seconds'),
          connected_clients: this.extractInfoValue(info, 'connected_clients'),
          used_memory: this.extractInfoValue(memory, 'used_memory_human'),
          used_memory_peak: this.extractInfoValue(memory, 'used_memory_peak_human')
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  extractInfoValue(info, key) {
    const lines = info.split('\r\n');
    const line = lines.find(l => l.startsWith(key + ':'));
    return line ? line.split(':')[1] : 'unknown';
  }

  // Statistics
  async getSystemStats() {
    try {
      const stats = {
        total_users: await redis.sCard('all_users'),
        total_transactions: (await redis.keys('transaction:*')).length,
        total_recurring: (await redis.keys('recurring:*')).length,
        total_assets: (await redis.keys('asset:*')).length,
        active_user_states: (await redis.keys('user_state:*')).length,
        cached_ai_responses: (await redis.keys('ai_cache:*')).length,
        stream_lengths: {}
      };
      
      // Get stream lengths
      const streams = ['transactions', 'transaction_deletions', 'transactions_updated', 'recurring_created', 'recurring_executed', 'assets_created'];
      for (const stream of streams) {
        try {
          stats.stream_lengths[stream] = await redis.xLen(stream);
        } catch (error) {
          stats.stream_lengths[stream] = 0;
        }
      }
      
      return stats;
    } catch (error) {
      console.error('Get system stats error:', error);
      return null;
    }
  }
}

// Create search indexes (updated)
async function createSearchIndexes() {
  try {
    // Delete existing index if it exists
    try {
      await redis.ft.dropIndex('transactions_idx');
    } catch (e) {
      // Index doesn't exist, continue
    }
    
    // Create new index with proper field types
    await redis.ft.create('transactions_idx', {
      '$.user_id': { 
        type: 'TEXT', 
        AS: 'user_id' 
      },
      '$.description': { 
        type: 'TEXT', 
        AS: 'description',
        PHONETIC: 'dm:en'
      },
      '$.category': { 
        type: 'TAG', 
        AS: 'category' 
      },
      '$.amount_myr': { 
        type: 'NUMERIC', 
        AS: 'amount' 
      },
      '$.type': { 
        type: 'TAG', 
        AS: 'type' 
      },
      '$.date': { 
        type: 'TEXT', 
        AS: 'date' 
      },
      '$.is_future': {
        type: 'TAG',
        AS: 'is_future'
      }
    }, { 
      ON: 'JSON', 
      PREFIX: 'transaction:' 
    });
    
    console.log('✅ Search indexes created successfully');
  } catch (error) {
    if (error.message.includes('Index already exists')) {
      console.log('✅ Search indexes already exist');
    } else {
      console.error('❌ Error creating search indexes:', error);
    }
  }
}

// Initialize cleanup scheduler
function initializeCleanupScheduler() {
  const redisService = new RedisService();
  
  // Run cleanup every hour
  setInterval(async () => {
    try {
      await redisService.cleanupExpiredData();
    } catch (error) {
      console.error('Scheduled cleanup error:', error);
    }
  }, 3600000); // 1 hour
  
  console.log('✅ Cleanup scheduler initialized');
}

module.exports = { 
  RedisService: new RedisService(), 
  createSearchIndexes,
  initializeCleanupScheduler
};