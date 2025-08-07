// src/services/recurring.js

const redis = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');
const { RedisService } = require('./redis');

class RecurringService {
  async createRecurringTransaction(userId, data) {
    try {
      const recurringId = uuidv4();
      const recurring = {
        id: recurringId,
        user_id: userId.toString(),
        amount_myr: parseFloat(data.amount),
        type: data.type,
        category: data.category,
        description: data.description,
        frequency: data.frequency,
        start_date: data.start_date || new Date().toISOString(),
        end_date: data.end_date || null,
        next_due: data.next_due || this.calculateNextDue(new Date().toISOString(), data.frequency),
        is_active: true,
        created_at: new Date().toISOString(),
        last_executed: null,
        execution_count: 0
      };

      // Store recurring transaction using RedisJSON
      await redis.json.set(`recurring:${recurringId}`, '$', recurring);
      
      // Add to user's recurring list
      await redis.lPush(`user:${userId}:recurring`, recurringId);
      
      // Add to global recurring index for processing
      await redis.sAdd('active_recurring', recurringId);
      
      // Add to stream for tracking
      await redis.xAdd('recurring_created', '*', {
        user_id: userId.toString(),
        recurring_id: recurringId.toString(),
        frequency: recurring.frequency,
        amount: recurring.amount_myr.toString(),
        next_due: recurring.next_due,
        timestamp: Date.now().toString()
      });

      console.log(`✅ Created recurring transaction: ${recurringId} for user ${userId}`);
      return recurring;
    } catch (error) {
      console.error('Create recurring transaction error:', error);
      throw error;
    }
  }

  async getActiveRecurring(userId) {
    try {
      const recurringIds = await redis.lRange(`user:${userId}:recurring`, 0, -1);
      const activeRecurring = [];
      
      for (const recurringId of recurringIds) {
        try {
          const recurring = await redis.json.get(`recurring:${recurringId}`);
          if (recurring && recurring.is_active) {
            activeRecurring.push(recurring);
          } else if (!recurring) {
            // Clean up invalid reference
            await redis.lRem(`user:${userId}:recurring`, 1, recurringId);
            await redis.sRem('active_recurring', recurringId);
          }
        } catch (error) {
          console.error(`Error getting recurring ${recurringId}:`, error);
          // Clean up invalid reference
          await redis.lRem(`user:${userId}:recurring`, 1, recurringId);
          await redis.sRem('active_recurring', recurringId);
        }
      }
      
      // Sort by next due date
      activeRecurring.sort((a, b) => new Date(a.next_due) - new Date(b.next_due));
      
      return activeRecurring;
    } catch (error) {
      console.error('Get active recurring error:', error);
      return [];
    }
  }

  async getRecurring(recurringId) {
    try {
      const recurring = await redis.json.get(`recurring:${recurringId}`);
      return recurring;
    } catch (error) {
      console.error('Get recurring error:', error);
      return null;
    }
  }

  async deleteRecurring(userId, recurringId) {
    try {
      const recurring = await this.getRecurring(recurringId);
      
      if (!recurring || recurring.user_id !== userId.toString()) {
        return { success: false, error: 'Recurring transaction not found or unauthorized' };
      }
      
      // Mark as inactive instead of deleting (for audit trail)
      await redis.json.set(`recurring:${recurringId}`, '$.is_active', false);
      await redis.json.set(`recurring:${recurringId}`, '$.deleted_at', new Date().toISOString());
      
      // Remove from active sets
      await redis.sRem('active_recurring', recurringId);
      
      // Add to deletion stream
      await redis.xAdd('recurring_deleted', '*', {
        user_id: userId.toString(),
        recurring_id: recurringId.toString(),
        deleted_at: Date.now().toString()
      });
      
      console.log(`✅ Deleted recurring transaction: ${recurringId} for user ${userId}`);
      return { success: true, recurring };
    } catch (error) {
      console.error('Delete recurring error:', error);
      return { success: false, error: 'Failed to delete recurring transaction' };
    }
  }

  async processDueRecurring() {
    try {
      const now = new Date();
      const activeRecurringIds = await redis.sMembers('active_recurring');
      
      let processedCount = 0;
      
      for (const recurringId of activeRecurringIds) {
        try {
          const recurring = await redis.json.get(`recurring:${recurringId}`);
          
          if (!recurring || !recurring.is_active) {
            // Clean up inactive recurring
            await redis.sRem('active_recurring', recurringId);
            continue;
          }
          
          const nextDue = new Date(recurring.next_due);
          
          if (nextDue <= now) {
            await this.executeRecurring(recurring);
            processedCount++;
          }
        } catch (error) {
          console.error(`Error processing recurring ${recurringId}:`, error);
          // Remove problematic recurring from active set
          await redis.sRem('active_recurring', recurringId);
        }
      }
      
      if (processedCount > 0) {
        console.log(`✅ Processed ${processedCount} due recurring transactions`);
      }
      
      return processedCount;
    } catch (error) {
      console.error('Process due recurring error:', error);
      return 0;
    }
  }

  async executeRecurring(recurring) {
    try {
      // Create the actual transaction
      const transaction = await RedisService.createTransaction(recurring.user_id, {
        amount: recurring.amount_myr,
        type: recurring.type,
        category: recurring.category,
        description: `${recurring.description} (Auto)`
      });
      
      // Update recurring transaction
      const nextDue = this.calculateNextDue(recurring.next_due, recurring.frequency);
      const executionCount = (recurring.execution_count || 0) + 1;
      
      await redis.json.set(`recurring:${recurring.id}`, '$.next_due', nextDue);
      await redis.json.set(`recurring:${recurring.id}`, '$.last_executed', new Date().toISOString());
      await redis.json.set(`recurring:${recurring.id}`, '$.execution_count', executionCount);
      
      // Check if recurring should end
      if (recurring.end_date && new Date(nextDue) > new Date(recurring.end_date)) {
        await redis.json.set(`recurring:${recurring.id}`, '$.is_active', false);
        await redis.sRem('active_recurring', recurring.id);
      }
      
      // Add to execution stream
      await redis.xAdd('recurring_executed', '*', {
        user_id: recurring.user_id,
        recurring_id: recurring.id,
        transaction_id: transaction.id,
        amount: recurring.amount_myr.toString(),
        execution_count: executionCount.toString(),
        next_due: nextDue,
        timestamp: Date.now().toString()
      });
      
      console.log(`✅ Executed recurring transaction: ${recurring.id} -> ${transaction.id}`);
      return transaction;
    } catch (error) {
      console.error('Execute recurring error:', error);
      throw error;
    }
  }

  calculateNextDue(currentDue, frequency) {
    const date = new Date(currentDue);
    
    switch (frequency) {
      case 'daily':
        date.setDate(date.getDate() + 1);
        break;
      case 'weekly':
        date.setDate(date.getDate() + 7);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'yearly':
        date.setFullYear(date.getFullYear() + 1);
        break;
      default:
        date.setMonth(date.getMonth() + 1); // Default to monthly
    }
    
    return date.toISOString();
  }

  async getRecurringStats(userId) {
    try {
      const activeRecurring = await this.getActiveRecurring(userId);
      
      const stats = {
        total_active: activeRecurring.length,
        by_frequency: {},
        by_type: { income: 0, expense: 0 },
        total_monthly_impact: 0
      };
      
      activeRecurring.forEach(recurring => {
        // Count by frequency
        stats.by_frequency[recurring.frequency] = (stats.by_frequency[recurring.frequency] || 0) + 1;
        
        // Count by type
        stats.by_type[recurring.type]++;
        
        // Calculate monthly impact
        let monthlyAmount = recurring.amount_myr;
        switch (recurring.frequency) {
          case 'daily': monthlyAmount *= 30; break;
          case 'weekly': monthlyAmount *= 4.33; break;
          case 'yearly': monthlyAmount /= 12; break;
          // monthly stays the same
        }
        
        if (recurring.type === 'income') {
          stats.total_monthly_impact += monthlyAmount;
        } else {
          stats.total_monthly_impact -= monthlyAmount;
        }
      });
      
      return stats;
    } catch (error) {
      console.error('Get recurring stats error:', error);
      return null;
    }
  }
}

module.exports = new RecurringService();