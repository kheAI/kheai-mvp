// src/services/liabilities.js
const redis = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');

class LiabilityService {
  async createLiability(userId, liabilityData) {
    try {
      const liabilityId = uuidv4();
      const liability = {
        id: liabilityId,
        user_id: userId.toString(),
        name: liabilityData.name,
        type: liabilityData.type,
        category: this.classifyLiabilityCategory(liabilityData.type),
        current_balance_myr: parseFloat(liabilityData.balance),
        original_amount_myr: parseFloat(liabilityData.original_amount || liabilityData.balance),
        interest_rate: parseFloat(liabilityData.interest_rate || 0),
        due_date: liabilityData.due_date || null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        journal_entry_id: null // Track associated journal entry
      };

      await redis.json.set(`liability:${liabilityId}`, '$', liability);
      await redis.lPush(`user:${userId}:liabilities`, liabilityId);

      // CREATE JOURNAL ENTRY FOR LIABILITY ADDITION
      try {
        const LedgerService = require('./ledger');
        let liabilityAccountCode = '2000'; // Default to Accounts Payable
        let assetAccountCode = '1100'; // Bank account (assuming cash received)
        
        // Determine correct liability account
        if (liabilityData.type === 'loan') liabilityAccountCode = '2200';
        else if (liabilityData.type === 'credit_card') liabilityAccountCode = '2200'; // FIXED: Use Short-term Loans
        else if (liabilityData.type === 'mortgage') liabilityAccountCode = '2500';
        else if (liabilityData.type === 'business_loan') liabilityAccountCode = '2500';
        
        const journalEntry = await LedgerService.createJournalEntry(userId, {
          description: `${liabilityData.name} liability`,
          reference: `LIAB-${liabilityId.substring(0, 8)}`,
          lines: [
            {
              account_code: assetAccountCode,
              debit: parseFloat(liabilityData.balance),
              credit: 0,
              description: `Cash from ${liabilityData.name}`
            },
            {
              account_code: liabilityAccountCode,
              debit: 0,
              credit: parseFloat(liabilityData.balance),
              description: `${liabilityData.name} liability`
            }
          ]
        });

        // Link the journal entry to the liability
        await redis.json.set(`liability:${liabilityId}`, '$.journal_entry_id', journalEntry.id);
        
      } catch (journalError) {
        console.error('Liability journal entry error:', journalError);
      }

      console.log(`✅ Created liability: ${liabilityId} for user ${userId}`);
      return liability;
    } catch (error) {
      console.error('Create liability error:', error);
      throw error;
    }
  }

  async getUserLiabilities(userId) {
    try {
      const liabilityIds = await redis.lRange(`user:${userId}:liabilities`, 0, -1);
      const liabilities = [];
      
      for (const liabilityId of liabilityIds) {
        try {
          const liability = await redis.json.get(`liability:${liabilityId}`);
          if (liability && liability.is_active) {
            liabilities.push(liability);
          } else if (!liability) {
            await redis.lRem(`user:${userId}:liabilities`, 1, liabilityId);
          }
        } catch (error) {
          await redis.lRem(`user:${userId}:liabilities`, 1, liabilityId);
        }
      }
      
      return liabilities.sort((a, b) => b.current_balance_myr - a.current_balance_myr);
    } catch (error) {
      console.error('Get user liabilities error:', error);
      return [];
    }
  }

  async deleteLiability(userId, liabilityId) {
    try {
      const liability = await redis.json.get(`liability:${liabilityId}`);
      
      if (!liability || liability.user_id !== userId.toString()) {
        return { success: false, error: 'Liability not found or unauthorized' };
      }
      
      // DELETE ASSOCIATED JOURNAL ENTRY
      try {
        if (liability.journal_entry_id) {
          const LedgerService = require('./ledger');
          const journalEntry = await redis.json.get(`journal:${liability.journal_entry_id}`);
          
          if (journalEntry) {
            // Reverse the journal entry from ledger
            await this.reverseJournalFromLedger(userId, journalEntry);
            // Delete the journal entry
            await redis.del(`journal:${liability.journal_entry_id}`);
            await redis.lRem(`user:${userId}:journals`, 1, liability.journal_entry_id);
          }
        }
      } catch (journalError) {
        console.error('Liability journal deletion error:', journalError);
      }
      
      await redis.json.set(`liability:${liabilityId}`, '$.is_active', false);
      await redis.json.set(`liability:${liabilityId}`, '$.deleted_at', new Date().toISOString());
      
      console.log(`✅ Deleted liability: ${liabilityId} for user ${userId}`);
      return { success: true, liability };
    } catch (error) {
      console.error('Delete liability error:', error);
      return { success: false, error: 'Failed to delete liability' };
    }
  }

  async reverseJournalFromLedger(userId, journalEntry) {
    try {
      const month = new Date(journalEntry.date).getMonth() + 1;
      const year = new Date(journalEntry.date).getFullYear();

      for (const entry of journalEntry.entries) {
        const ledgerKey = `ledger:${userId}:${entry.account_code}:${year}:${month}`;
        
        // REVERSE the totals
        if (entry.debit_amount > 0) {
          await redis.hIncrByFloat(ledgerKey, 'total_debits', -entry.debit_amount);
        }
        if (entry.credit_amount > 0) {
          await redis.hIncrByFloat(ledgerKey, 'total_credits', -entry.credit_amount);
        }

        // REVERSE balance change
        const balanceChange = -(entry.debit_amount - entry.credit_amount);
        
        // Get account type to determine how to reverse
        const accountCode = entry.account_code;
        const isAssetOrExpense = accountCode.startsWith('1') || accountCode.startsWith('5');
        
        if (isAssetOrExpense) {
          await redis.hIncrByFloat(ledgerKey, 'balance', balanceChange);
        } else {
          await redis.hIncrByFloat(ledgerKey, 'balance', -balanceChange);
        }
        
        await redis.hSet(ledgerKey, 'last_updated', new Date().toISOString());
      }
      
      console.log(`✅ Reversed journal entry: ${journalEntry.id}`);
    } catch (error) {
      console.error('Reverse journal error:', error);
      throw error;
    }
  }

  classifyLiabilityCategory(liabilityType) {
    const categoryMap = {
      'credit_card': 'current',
      'accounts_payable': 'current',
      'short_term_loan': 'current',
      'accrued_expenses': 'current',
      'loan': 'current',
      'mortgage': 'long_term',
      'business_loan': 'long_term',
      'equipment_loan': 'long_term',
      'other': 'current'
    };
    
    return categoryMap[liabilityType] || 'current';
  }
}

module.exports = new LiabilityService();