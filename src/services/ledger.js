// src/services/ledger.js
const redis = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');

class LedgerService {
  constructor() {
    // Chart of Accounts - Malaysian business context
    this.chartOfAccounts = {
      // Assets (1000-1999)
      1000: { name: 'Cash', type: 'asset', category: 'current' },
      1100: { name: 'Bank - Current Account', type: 'asset', category: 'current' },
      1200: { name: 'Accounts Receivable', type: 'asset', category: 'current' },
      1300: { name: 'Inventory', type: 'asset', category: 'current' },
      1400: { name: 'Prepaid Expenses', type: 'asset', category: 'current' },
      1500: { name: 'Equipment', type: 'asset', category: 'fixed' },
      1600: { name: 'Accumulated Depreciation - Equipment', type: 'asset', category: 'fixed', isContra: true },
      1700: { name: 'Property', type: 'asset', category: 'fixed' },
      1800: { name: 'Bitcoin Treasury', type: 'asset', category: 'investment' },
      
      // Liabilities (2000-2999)
      2000: { name: 'Accounts Payable', type: 'liability', category: 'current' },
      2100: { name: 'Accrued Expenses', type: 'liability', category: 'current' },
      2200: { name: 'Short-term Loans', type: 'liability', category: 'current' },
      2300: { name: 'GST Payable', type: 'liability', category: 'current' },
      2400: { name: 'Income Tax Payable', type: 'liability', category: 'current' },
      2500: { name: 'Long-term Debt', type: 'liability', category: 'long_term' },
      
      // Equity (3000-3999)
      3000: { name: 'Owner\'s Equity', type: 'equity', category: 'capital' },
      3100: { name: 'Retained Earnings', type: 'equity', category: 'retained' },
      3200: { name: 'Current Year Earnings', type: 'equity', category: 'current' },
      
      // Revenue (4000-4999) - These should NOT appear on balance sheet
      4000: { name: 'Sales Revenue', type: 'revenue', category: 'operating' },
      4100: { name: 'Service Revenue', type: 'revenue', category: 'operating' },
      4200: { name: 'Rental Income', type: 'revenue', category: 'operating' },
      4300: { name: 'Interest Income', type: 'revenue', category: 'non_operating' },
      4400: { name: 'Bitcoin Gains', type: 'revenue', category: 'investment' },
      
      // Expenses (5000-5999) - These should NOT appear on balance sheet
      5000: { name: 'Cost of Goods Sold', type: 'expense', category: 'cogs' },
      5100: { name: 'Rent Expense', type: 'expense', category: 'operating' },
      5200: { name: 'Utilities Expense', type: 'expense', category: 'operating' },
      5300: { name: 'Marketing Expense', type: 'expense', category: 'operating' },
      5400: { name: 'Office Supplies', type: 'expense', category: 'operating' },
      5500: { name: 'Professional Fees', type: 'expense', category: 'operating' },
      5600: { name: 'Depreciation Expense', type: 'expense', category: 'operating' },
      5700: { name: 'Interest Expense', type: 'expense', category: 'non_operating' },
      5800: { name: 'Bitcoin Losses', type: 'expense', category: 'investment' }
    };
  }

  async createJournalEntry(userId, entryData) {
    try {
      const journalId = uuidv4();
      const journalEntry = {
        id: journalId,
        user_id: userId.toString(),
        date: entryData.date || new Date().toISOString(),
        reference: entryData.reference || `JE-${Date.now()}`,
        description: entryData.description,
        total_debit: 0,
        total_credit: 0,
        entries: [],
        created_at: new Date().toISOString(),
        created_by: 'ai_assistant'
      };

      // Process each line item
      for (const line of entryData.lines) {
        const lineEntry = {
          account_code: line.account_code,
          account_name: this.chartOfAccounts[line.account_code]?.name || 'Unknown Account',
          debit_amount: parseFloat(line.debit || 0),
          credit_amount: parseFloat(line.credit || 0),
          description: line.description || entryData.description
        };

        journalEntry.entries.push(lineEntry);
        journalEntry.total_debit += lineEntry.debit_amount;
        journalEntry.total_credit += lineEntry.credit_amount;
      }

      // Validate double-entry (debits = credits)
      if (Math.abs(journalEntry.total_debit - journalEntry.total_credit) > 0.01) {
        throw new Error(`Journal entry not balanced: Debits RM${journalEntry.total_debit.toFixed(2)} ≠ Credits RM${journalEntry.total_credit.toFixed(2)}`);
      }

      // Store journal entry
      await redis.json.set(`journal:${journalId}`, '$', journalEntry);
      await redis.lPush(`user:${userId}:journals`, journalId);

      // Update general ledger accounts
      await this.updateGeneralLedger(userId, journalEntry);

      // Add to journal stream
      await redis.xAdd('journal_entries', '*', {
        user_id: userId.toString(),
        journal_id: journalId,
        amount: journalEntry.total_debit.toString(),
        description: journalEntry.description,
        timestamp: Date.now().toString()
      });

      console.log(`✅ Created journal entry: ${journalId} for user ${userId}`);
      return journalEntry;
    } catch (error) {
      console.error('Create journal entry error:', error);
      throw error;
    }
  }

  async updateGeneralLedger(userId, journalEntry) {
    try {
      const month = new Date(journalEntry.date).getMonth() + 1;
      const year = new Date(journalEntry.date).getFullYear();

      for (const entry of journalEntry.entries) {
        const ledgerKey = `ledger:${userId}:${entry.account_code}:${year}:${month}`;
        
        // Update account balance
        if (entry.debit_amount > 0) {
          await redis.hIncrByFloat(ledgerKey, 'total_debits', entry.debit_amount);
        }
        if (entry.credit_amount > 0) {
          await redis.hIncrByFloat(ledgerKey, 'total_credits', entry.credit_amount);
        }

        // Calculate running balance based on account type
        const accountInfo = this.chartOfAccounts[entry.account_code];
        let balanceChange = 0;

        if (['asset', 'expense'].includes(accountInfo?.type)) {
          // Assets and Expenses increase with debits
          balanceChange = entry.debit_amount - entry.credit_amount;
        } else {
          // Liabilities, Equity, Revenue increase with credits
          balanceChange = entry.credit_amount - entry.debit_amount;
        }

        await redis.hIncrByFloat(ledgerKey, 'balance', balanceChange);
        await redis.hSet(ledgerKey, 'last_updated', new Date().toISOString());
        await redis.expire(ledgerKey, 86400 * 365 * 7); // 7 years retention
      }
    } catch (error) {
      console.error('Update general ledger error:', error);
      throw error;
    }
  }

  async getTrialBalance(userId, year = null, month = null) {
    try {
      const targetYear = year || new Date().getFullYear();
      const targetMonth = month || new Date().getMonth() + 1;
      
      const trialBalance = [];
      let totalDebits = 0;
      let totalCredits = 0;

      for (const [accountCode, accountInfo] of Object.entries(this.chartOfAccounts)) {
        const ledgerKey = `ledger:${userId}:${accountCode}:${targetYear}:${targetMonth}`;
        const ledgerData = await redis.hGetAll(ledgerKey);

        if (ledgerData.balance) {
          const balance = parseFloat(ledgerData.balance);
          const debits = parseFloat(ledgerData.total_debits || 0);
          const credits = parseFloat(ledgerData.total_credits || 0);

          if (balance !== 0 || debits !== 0 || credits !== 0) {
            const entry = {
              account_code: accountCode,
              account_name: accountInfo.name,
              account_type: accountInfo.type,
              debit_balance: balance > 0 && ['asset', 'expense'].includes(accountInfo.type) ? balance : 0,
              credit_balance: balance > 0 && ['liability', 'equity', 'revenue'].includes(accountInfo.type) ? balance : 0,
              total_debits: debits,
              total_credits: credits
            };

            trialBalance.push(entry);
            totalDebits += entry.debit_balance;
            totalCredits += entry.credit_balance;
          }
        }
      }

      return {
        period: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
        accounts: trialBalance.sort((a, b) => parseInt(a.account_code) - parseInt(b.account_code)),
        total_debits: totalDebits,
        total_credits: totalCredits,
        is_balanced: Math.abs(totalDebits - totalCredits) < 0.01
      };
    } catch (error) {
      console.error('Get trial balance error:', error);
      throw error;
    }
  }

  async generateBalanceSheet(userId, asOfDate = null) {
    try {
      const date = asOfDate ? new Date(asOfDate) : new Date();
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      const balanceSheet = {
        as_of_date: date.toISOString().split('T')[0],
        assets: { current: [], fixed: [], investment: [], total: 0 },
        liabilities: { current: [], long_term: [], total: 0 },
        equity: { items: [], total: 0 }
      };

      // Get all account balances for ALL months up to the target date
      for (const [accountCode, accountInfo] of Object.entries(this.chartOfAccounts)) {
        if (!['asset', 'liability', 'equity'].includes(accountInfo.type)) continue;

        let cumulativeBalance = 0;
        
        // Sum balances from all months up to target month
        for (let m = 1; m <= month; m++) {
          const ledgerKey = `ledger:${userId}:${accountCode}:${year}:${m}`;
          const ledgerData = await redis.hGetAll(ledgerKey);
          const monthBalance = parseFloat(ledgerData.balance || 0);
          cumulativeBalance += monthBalance;
        }

        if (Math.abs(cumulativeBalance) > 0.01) { // Only include accounts with significant balances
          const item = {
            account_code: accountCode,
            account_name: accountInfo.name,
            balance: Math.abs(cumulativeBalance)
          };

          if (accountInfo.type === 'asset') {
            const category = accountInfo.category || 'current';
            if (!balanceSheet.assets[category]) {
              balanceSheet.assets[category] = [];
            }
            balanceSheet.assets[category].push(item);
            balanceSheet.assets.total += item.balance;
          } else if (accountInfo.type === 'liability') {
            const category = accountInfo.category || 'current';
            if (!balanceSheet.liabilities[category]) {
              balanceSheet.liabilities[category] = [];
            }
            balanceSheet.liabilities[category].push(item);
            balanceSheet.liabilities.total += item.balance;
          } else if (accountInfo.type === 'equity') {
            balanceSheet.equity.items.push(item);
            balanceSheet.equity.total += item.balance;
          }
        }
      }

      // CRITICAL FIX: Add current period earnings to equity
      const currentDate = new Date();
      const startOfYear = new Date(currentDate.getFullYear(), 0, 1);
      const incomeStatement = await this.generateIncomeStatement(userId, startOfYear, date);
      
      if (Math.abs(incomeStatement.net_income) > 0.01) {
        balanceSheet.equity.items.push({
          account_code: '3200',
          account_name: 'Current Year Earnings',
          balance: Math.abs(incomeStatement.net_income)
        });
        balanceSheet.equity.total += Math.abs(incomeStatement.net_income);
      }

      balanceSheet.total_liabilities_equity = balanceSheet.liabilities.total + balanceSheet.equity.total;
      balanceSheet.is_balanced = Math.abs(balanceSheet.assets.total - balanceSheet.total_liabilities_equity) < 0.01;

      // Debug logging
      console.log(`📊 Balance Sheet Debug for user ${userId}:`);
      console.log(`   Assets: RM${balanceSheet.assets.total.toFixed(2)}`);
      console.log(`   Liabilities: RM${balanceSheet.liabilities.total.toFixed(2)}`);
      console.log(`   Equity: RM${balanceSheet.equity.total.toFixed(2)}`);
      console.log(`   Net Income: RM${incomeStatement.net_income.toFixed(2)}`);
      console.log(`   Balanced: ${balanceSheet.is_balanced}`);

      return balanceSheet;
    } catch (error) {
      console.error('Generate balance sheet error:', error);
      throw error;
    }
  }

  async generateIncomeStatement(userId, startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const incomeStatement = {
        period: `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
        revenue: { items: [], total: 0 },
        cogs: { items: [], total: 0 },
        gross_profit: 0,
        operating_expenses: { items: [], total: 0 },
        operating_income: 0,
        other_income: { items: [], total: 0 },
        other_expenses: { items: [], total: 0 },
        net_income: 0
      };

      // Process each month in the period
      let currentDate = new Date(start);
      while (currentDate <= end) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;

        for (const [accountCode, accountInfo] of Object.entries(this.chartOfAccounts)) {
          if (!['revenue', 'expense'].includes(accountInfo.type)) continue;

          const ledgerKey = `ledger:${userId}:${accountCode}:${year}:${month}`;
          const ledgerData = await redis.hGetAll(ledgerKey);
          const balance = parseFloat(ledgerData.balance || 0);

          if (balance !== 0) {
            const item = {
              account_code: accountCode,
              account_name: accountInfo.name,
              amount: Math.abs(balance)
            };

            if (accountInfo.type === 'revenue') {
              if (accountInfo.category === 'operating') {
                incomeStatement.revenue.items.push(item);
                incomeStatement.revenue.total += item.amount;
              } else {
                incomeStatement.other_income.items.push(item);
                incomeStatement.other_income.total += item.amount;
              }
            } else if (accountInfo.type === 'expense') {
              if (accountInfo.category === 'cogs') {
                incomeStatement.cogs.items.push(item);
                incomeStatement.cogs.total += item.amount;
              } else if (accountInfo.category === 'operating') {
                incomeStatement.operating_expenses.items.push(item);
                incomeStatement.operating_expenses.total += item.amount;
              } else {
                incomeStatement.other_expenses.items.push(item);
                incomeStatement.other_expenses.total += item.amount;
              }
            }
          }
        }

        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      // Calculate totals
      incomeStatement.gross_profit = incomeStatement.revenue.total - incomeStatement.cogs.total;
      incomeStatement.operating_income = incomeStatement.gross_profit - incomeStatement.operating_expenses.total;
      incomeStatement.net_income = incomeStatement.operating_income + 
                                  incomeStatement.other_income.total - 
                                  incomeStatement.other_expenses.total;

      return incomeStatement;
    } catch (error) {
      console.error('Generate income statement error:', error);
      throw error;
    }
  }

  async generateCashflowStatement(userId, startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const cashflowStatement = {
        period: `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
        operating_activities: { items: [], total: 0 },
        investing_activities: { items: [], total: 0 },
        financing_activities: { items: [], total: 0 },
        net_change_in_cash: 0,
        beginning_cash: 0,
        ending_cash: 0
      };

      // Get net income from income statement
      const incomeStatement = await this.generateIncomeStatement(userId, startDate, endDate);
      cashflowStatement.operating_activities.items.push({
        description: 'Net Income',
        amount: incomeStatement.net_income
      });
      cashflowStatement.operating_activities.total += incomeStatement.net_income;

      // Add back non-cash expenses (depreciation)
      // Get depreciation expense
      let currentDate = new Date(start);
      while (currentDate <= end) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        
        const depreciationKey = `ledger:${userId}:5600:${year}:${month}`;
        const depreciationData = await redis.hGetAll(depreciationKey);
        const depreciation = parseFloat(depreciationData.balance || 0);
        
        if (depreciation > 0) {
          cashflowStatement.operating_activities.items.push({
            description: 'Depreciation Expense',
            amount: depreciation
          });
          cashflowStatement.operating_activities.total += depreciation;
        }
        
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      // Calculate changes in working capital
      const workingCapitalAccounts = [1200, 1300, 1400, 2000, 2100]; // AR, Inventory, Prepaid, AP, Accrued
      for (const accountCode of workingCapitalAccounts) {
        const accountInfo = this.chartOfAccounts[accountCode];
        if (!accountInfo) continue;

        // Get beginning and ending balances
        const beginningBalance = await this.getAccountBalance(userId, accountCode, start);
        const endingBalance = await this.getAccountBalance(userId, accountCode, end);
        const change = endingBalance - beginningBalance;

        if (Math.abs(change) > 0.01) {
          let cashEffect = 0;
          if (accountInfo.type === 'asset') {
            cashEffect = -change; // Increase in assets uses cash
          } else {
            cashEffect = change; // Increase in liabilities provides cash
          }

          cashflowStatement.operating_activities.items.push({
            description: `Change in ${accountInfo.name}`,
            amount: cashEffect
          });
          cashflowStatement.operating_activities.total += cashEffect;
        }
      }

      // Investing activities (equipment, property, bitcoin purchases)
      const investingAccounts = [1500, 1700, 1800]; // Equipment, Property, Bitcoin
      for (const accountCode of investingAccounts) {
        const accountInfo = this.chartOfAccounts[accountCode];
        if (!accountInfo) continue;

        const beginningBalance = await this.getAccountBalance(userId, accountCode, start);
        const endingBalance = await this.getAccountBalance(userId, accountCode, end);
        const change = endingBalance - beginningBalance;

        if (Math.abs(change) > 0.01) {
          cashflowStatement.investing_activities.items.push({
            description: `Purchase of ${accountInfo.name}`,
            amount: -change // Purchases are negative cash flow
          });
          cashflowStatement.investing_activities.total -= change;
        }
      }

      // Financing activities (loans, owner equity)
      const financingAccounts = [2500, 3000]; // Long-term debt, Owner's equity
      for (const accountCode of financingAccounts) {
        const accountInfo = this.chartOfAccounts[accountCode];
        if (!accountInfo) continue;

        const beginningBalance = await this.getAccountBalance(userId, accountCode, start);
        const endingBalance = await this.getAccountBalance(userId, accountCode, end);
        const change = endingBalance - beginningBalance;

        if (Math.abs(change) > 0.01) {
          cashflowStatement.financing_activities.items.push({
            description: `Change in ${accountInfo.name}`,
            amount: change
          });
          cashflowStatement.financing_activities.total += change;
        }
      }

      // Calculate net change in cash
      cashflowStatement.net_change_in_cash = 
        cashflowStatement.operating_activities.total +
        cashflowStatement.investing_activities.total +
        cashflowStatement.financing_activities.total;

      // Get beginning and ending cash balances
      cashflowStatement.beginning_cash = await this.getAccountBalance(userId, 1000, start) + 
                                        await this.getAccountBalance(userId, 1100, start);
      cashflowStatement.ending_cash = cashflowStatement.beginning_cash + cashflowStatement.net_change_in_cash;

      return cashflowStatement;
    } catch (error) {
      console.error('Generate cashflow statement error:', error);
      throw error;
    }
  }

  async getAccountBalance(userId, accountCode, asOfDate) {
    try {
      const date = new Date(asOfDate);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      const ledgerKey = `ledger:${userId}:${accountCode}:${year}:${month}`;
      const ledgerData = await redis.hGetAll(ledgerKey);
      
      return parseFloat(ledgerData.balance || 0);
    } catch (error) {
      console.error('Get account balance error:', error);
      return 0;
    }
  }

  // AI-powered transaction to journal entry conversion
  async convertTransactionToJournalEntry(userId, transaction) {
    try {
      const lines = [];
      
      if (transaction.type === 'income') {
        // Debit: Cash/Bank
        lines.push({
          account_code: '1100', // Bank - Current Account
          debit: transaction.amount_myr,
          credit: 0,
          description: transaction.description
        });
        
        // Credit: Revenue account based on category
        let revenueAccount = '4000'; // Default: Sales Revenue
        if (transaction.category === 'rental') revenueAccount = '4200';
        else if (transaction.category === 'commission') revenueAccount = '4100';
        
        lines.push({
          account_code: revenueAccount,
          debit: 0,
          credit: transaction.amount_myr,
          description: transaction.description
        });
      } else {
        // Expense transaction
        let expenseAccount = '5400'; // Default: Office Supplies
        if (transaction.category === 'rent') expenseAccount = '5100';
        else if (transaction.category === 'utilities') expenseAccount = '5200';
        else if (transaction.category === 'marketing') expenseAccount = '5300';
        else if (transaction.category === 'inventory') expenseAccount = '5000';
        
        // Debit: Expense account
        lines.push({
          account_code: expenseAccount,
          debit: transaction.amount_myr,
          credit: 0,
          description: transaction.description
        });
        
        // Credit: Cash/Bank
        lines.push({
          account_code: '1100', // Bank - Current Account
          debit: 0,
          credit: transaction.amount_myr,
          description: transaction.description
        });
      }
      
      return await this.createJournalEntry(userId, {
        description: transaction.description,
        reference: `TXN-${transaction.id.substring(0, 8)}`,
        date: transaction.date,
        lines: lines
      });
    } catch (error) {
      console.error('Convert transaction to journal entry error:', error);
      throw error;
    }
  }
}

module.exports = new LedgerService();