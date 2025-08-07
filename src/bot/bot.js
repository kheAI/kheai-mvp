// src/bot/bot.js
const AIService = require('../services/ai');
const { RedisService } = require('../services/redis');
const redis = require('../../config/redis');

// Safe require function to handle missing services
const safeRequire = (modulePath, fallbackName) => {
  try {
    return require(modulePath);
  } catch (e) {
    console.log(`⚠️ ${fallbackName} not available: ${e.message}`);
    return null;
  }
};

// Try to import enhanced services, but don't fail if they're not available
const RecurringService = safeRequire('../services/recurring', 'RecurringService');
const CashflowService = safeRequire('../services/cashflow', 'CashflowService');
const AssetService = safeRequire('../services/assets', 'AssetService');
const LedgerService = safeRequire('../services/ledger', 'LedgerService');
const LiabilityService = safeRequire('../services/liabilities', 'LiabilityService');

// Enhanced response templates
const responses = {
  welcome: `🎉 Welcome to kheAI Accounting!

Your AI-powered CFO for Malaysian microbusinesses.

🔹 AI-Powered Double-Entry Bookkeeping
🔹 Auto-Generated Financial Statements
🔹 Natural Language Transaction Processing
🔹 Bitcoin Treasury Management
🔹 Malaysian Business Compliance
🔹 Real-time Liquidity Analysis

Try these commands:
/help - See all commands
/insights - Business analysis
/balance_sheet - Financial position
/income_statement - Profit & loss

Or just type naturally: "Paid rent RM800" or "Sales RM500"
✨ Every transaction automatically creates proper journal entries!`,

  welcomeBack: (name) => `Welcome back, ${name}! 👋

Ready to manage your accounting?

Quick commands: /insights | /balance_sheet | /help`,

  transactionRecorded: (txn, balance, journalRef) => `✅ TRANSACTION & JOURNAL ENTRY RECORDED

${txn.type === 'income' ? '💰' : '💸'} ${txn.description}
💵 Amount: RM${txn.amount_myr.toFixed(2)}
📂 Category: ${txn.category}
📅 Date: ${new Date(txn.date).toLocaleDateString()}

📚 Journal Entry: ${journalRef}
📊 Current Balance: RM${balance.toFixed(2)}

Commands: /trial_balance | /balance_sheet | /income_statement`,

  parseError: `❌ I couldn't parse that transaction.

Try these formats:
• "Paid rent RM800"
• "Received sales RM1500"
• "Dr 5100 RM800, Cr 1100 RM800"

Or ask me anything about accounting! 🤖`,

  generalError: `❌ Sorry, I couldn't process that.

Try being more specific or use /help for available commands.`
};

// Helper function to reverse journal entry from ledger
async function reverseJournalFromLedger(userId, journalEntry) {
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
        // For assets/expenses: reverse the debit-credit difference
        await redis.hIncrByFloat(ledgerKey, 'balance', balanceChange);
      } else {
        // For liabilities/equity/revenue: reverse the credit-debit difference  
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

function initializeBot(bot) {
  console.log('🚀 Initializing kheAI Accounting Bot...');

  // Welcome & Onboarding
  bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /start command from user ${userId}`);
    
    try {
      const user = await RedisService.getUser(userId);
      
      if (!user || !user.id) {
        await RedisService.createUser(userId, {
          name: msg.from.first_name || 'User',
          language: 'en'
        });
        
        bot.sendMessage(userId, responses.welcome, {
          reply_markup: {
            remove_keyboard: true
          }
        });
      } else {
        bot.sendMessage(userId, responses.welcomeBack(user.name), {
          reply_markup: {
            remove_keyboard: true
          }
        });
      }
    } catch (error) {
      console.error('Start command error:', error);
      bot.sendMessage(userId, 'Welcome! Ready to manage your business accounting?', {
        reply_markup: {
          remove_keyboard: true
        }
      });
    }
  });

  // Enhanced Help command
  bot.onText(/\/help/, (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /help command from user ${userId}`);
    
    bot.sendMessage(userId, `🤖 kheAI ACCOUNTING COMMANDS

💰 TRANSACTIONS:
• "Sales RM500" or "Paid rent RM800" - Add transactions
• /transactions - View all transactions
• /search [term] - Find transactions
• /delete - Remove transactions (choose by number)
• /export - Download CSV

📚 ACCOUNTING & BOOKKEEPING:
• /trial_balance - View trial balance
• /balance_sheet - Generate balance sheet
• /income_statement - Profit & loss statement
• /cashflow_statement - Cash flow statement
• /chart_of_accounts - View account codes
• /journal - Create manual journal entries
• /journal_list - View all journal entries (🤖 auto + ✏️ manual)
• /journal_edit - Edit journal entries (fix AI mistakes)
• /journal_delete - Delete journal entries (choose by number)

💎 ASSETS & LIABILITIES:
• /assets_list - View/manage assets
• /assets_add - Add new asset (auto-creates journal entry)
• /liabilities_list - View/manage liabilities
• /liabilities_add - Add new liability (auto-creates journal entry)

💫 RECURRING TRANSACTIONS:
• /recurring_list - View recurring transactions
• "Monthly rent RM800" - Create recurring

📊 ANALYSIS & FORECASTING:
• /insights - Business analysis & AI recommendations
• /forecast - Cashflow projections (if available)

🪙 BITCOIN TREASURY:
• "Bitcoin price now?" - Current BTC price + allocation advice
• "How to buy Bitcoin safely?" - Security guide
• "Should I buy Bitcoin?" - Investment recommendations

🔧 MAINTENANCE & RECOVERY:
• /recover - Fix data issues & rebuild metrics
• /fix_metrics - Repair calculations
• /debug - System status & diagnostics
• /status - Service availability

✨ SMART FEATURES:
• Every transaction auto-creates journal entries
• Assets/liabilities auto-balance with equity/cash
• Proper double-entry bookkeeping maintained
• AI fixes accounting mistakes automatically
• View auto-generated vs manual entries
• Edit wrong AI-generated journal entries

Type naturally - I understand English and Malay!
Examples: "Beli inventory RM150", "Rental income RM800"`);
  });

  // Enhanced Insights command with accounting ratios
  bot.onText(/\/insights?/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /insights command from user ${userId}`);
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      // Force reconciliation first
      console.log(`🔄 Reconciling metrics for user ${userId} before insights`);
      await RedisService.reconcileBusinessMetrics(userId);
      
      // Get fresh metrics after reconciliation
      const metrics = await RedisService.getBusinessMetrics(userId);
      console.log(`📊 Metrics for user ${userId}:`, metrics);
      
      const revenue = parseFloat(metrics.total_revenue || 0);
      const expenses = parseFloat(metrics.total_expenses || 0);
      const profit = revenue - expenses;
      const profitMargin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0;
      
      // Get accounting insights
      let insights = 'Generating accounting insights...';
      try {
        if (LedgerService) {
          insights = await AIService.generateAccountingInsights(userId);
        } else {
          insights = await AIService.generateInsights(userId);
        }
      } catch (error) {
        console.error('AI insights error:', error);
        insights = 'AI insights temporarily unavailable. Your financial data shows above.';
      }
      
      let liquidityInfo = '';
      if (AssetService) {
        try {
          const liquidityData = await AssetService.getLiquidityBreakdown(userId);
          liquidityInfo = `\n💧 LIQUIDITY HEALTH:
• Liquid Assets: RM${liquidityData.liquid.total.toFixed(2)}
• Semi-Liquid: RM${liquidityData.semi_liquid.total.toFixed(2)}
• Liquidity Ratio: ${(liquidityData.liquidity_ratio * 100).toFixed(1)}%`;
        } catch (error) {
          console.error('Liquidity data error:', error);
        }
      }
      
      const dashboardMessage = `📊 BUSINESS DASHBOARD

THIS MONTH:
💰 Revenue: RM${revenue.toFixed(2)}
💸 Expenses: RM${expenses.toFixed(2)}
📈 Profit: RM${profit.toFixed(2)}
📊 Margin: ${profitMargin}%${liquidityInfo}

AI ACCOUNTING INSIGHTS:
${insights}

📝 Total Transactions: ${metrics.transaction_count || 0}

Commands: /balance_sheet | /income_statement | /trial_balance`;
      
      bot.sendMessage(userId, dashboardMessage);
      
    } catch (error) {
      console.error('Insights error:', error);
      bot.sendMessage(userId, '❌ Unable to generate insights. Try /recover first.');
    }
  });

  // Journal Entry command
  bot.onText(/\/journal/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /journal command from user ${userId}`);
    
    bot.sendMessage(userId, `📚 CREATE JOURNAL ENTRY

Type naturally or use accounting format:

NATURAL EXAMPLES:
• "Paid rent RM800"
• "Received sales RM1500"
• "Bought inventory RM500"

ACCOUNTING FORMAT:
• "Debit Rent Expense RM800, Credit Bank RM800"
• "Dr 5100 RM800, Cr 1100 RM800 - Monthly rent"

What journal entry would you like to create?`);
    
    await RedisService.setUserState(userId, 'awaiting_journal_entry', 'general');
  });

  // List all journal entries
  bot.onText(/\/journal_list/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /journal_list command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    try {
      const journalIds = await redis.lRange(`user:${userId}:journals`, 0, -1);
      
      if (journalIds.length === 0) {
        bot.sendMessage(userId, '📚 No journal entries found.');
        return;
      }
      
      let message = `📚 JOURNAL ENTRIES\n\nReply with number to view details:\n\n`;
      
      for (let i = 0; i < Math.min(10, journalIds.length); i++) {
        try {
          const journal = await redis.json.get(`journal:${journalIds[i]}`);
          if (journal) {
            const date = new Date(journal.date).toLocaleDateString();
            const isAuto = journal.reference.includes('TXN-') || journal.reference.includes('ASSET-') || journal.reference.includes('LIAB-');
            const autoFlag = isAuto ? '🤖' : '✏️';
            
            message += `${i + 1}. ${autoFlag} ${journal.description}\n`;
            message += `   ${journal.reference} • RM${journal.total_debit.toFixed(2)} • ${date}\n\n`;
          }
        } catch (error) {
          console.error(`Error getting journal ${journalIds[i]}:`, error);
        }
      }
      
      if (journalIds.length > 10) {
        message += `... and ${journalIds.length - 10} more entries\n\n`;
      }
      
      message += `🤖 = Auto-generated | ✏️ = Manual\nType number to view details`;
      
      bot.sendMessage(userId, message);
      
      await RedisService.setUserState(userId, 'awaiting_journal_view_number', journalIds.slice(0, 10));
      
    } catch (error) {
      console.error('Journal list error:', error);
      bot.sendMessage(userId, '❌ Unable to load journal entries.');
    }
  });

  // Journal edit command
  bot.onText(/\/journal_edit/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /journal_edit command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    try {
      const journalIds = await redis.lRange(`user:${userId}:journals`, 0, -1);
      
      if (journalIds.length === 0) {
        bot.sendMessage(userId, '📝 No journal entries to edit.');
        return;
      }
      
      let message = `📝 EDIT JOURNAL ENTRIES\n\nReply with the number to edit:\n\n`;
      
      const validJournals = [];
      let displayCount = 0;
      
      for (const journalId of journalIds) {
        if (displayCount >= 10) break;
        
        try {
          const journal = await redis.json.get(`journal:${journalId}`);
          if (journal) {
            const date = new Date(journal.date).toLocaleDateString();
            const isAuto = journal.reference.includes('TXN-') || journal.reference.includes('ASSET-') || journal.reference.includes('LIAB-');
            const autoFlag = isAuto ? '🤖' : '✏️';
            displayCount++;
            validJournals.push(journal);
            
            message += `${displayCount}. ${autoFlag} ${journal.description}\n`;
            message += `   ${journal.reference} • RM${journal.total_debit.toFixed(2)} • ${date}\n\n`;
          }
        } catch (error) {
          await redis.lRem(`user:${userId}:journals`, 1, journalId);
        }
      }
      
      if (validJournals.length === 0) {
        bot.sendMessage(userId, '📝 No valid journal entries found.');
        return;
      }
      
      message += `🤖 = Auto-generated (AI) | ✏️ = Manual\n`;
      message += `Type the number (1-${validJournals.length}) to edit:`;
      
      bot.sendMessage(userId, message);
      
      await RedisService.setUserState(userId, 'awaiting_journal_edit_number', validJournals);
      
    } catch (error) {
      console.error('Journal edit command error:', error);
      bot.sendMessage(userId, '❌ Unable to show journal entries.');
    }
  });

  // Simple journal deletion command (like transactions)
  bot.onText(/\/journal_delete/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /journal_delete command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    try {
      const journalIds = await redis.lRange(`user:${userId}:journals`, 0, -1);
      
      if (journalIds.length === 0) {
        bot.sendMessage(userId, '🗑️ No journal entries to delete.');
        return;
      }
      
      let message = `🗑️ RECENT JOURNAL ENTRIES\n\nReply with the number to delete:\n\n`;
      
      const validJournals = [];
      let displayCount = 0;
      
      for (const journalId of journalIds) {
        if (displayCount >= 10) break; // Show max 10
        
        try {
          const journal = await redis.json.get(`journal:${journalId}`);
          if (journal) {
            const date = new Date(journal.date).toLocaleDateString();
            const isAuto = journal.reference.includes('TXN-') || journal.reference.includes('ASSET-') || journal.reference.includes('LIAB-');
            const autoFlag = isAuto ? '🤖' : '✏️';
            
            displayCount++;
            validJournals.push(journal);
            
            message += `${displayCount}. ${autoFlag} ${journal.description} - RM${journal.total_debit.toFixed(2)} (${date})\n`;
          }
        } catch (error) {
          // Skip invalid journals
          await redis.lRem(`user:${userId}:journals`, 1, journalId);
        }
      }
      
      if (validJournals.length === 0) {
        bot.sendMessage(userId, '🗑️ No valid journal entries found.');
        return;
      }
      
      message += `\n🤖 = Auto-generated | ✏️ = Manual\n`;
      message += `Type the number (1-${validJournals.length}) to delete:`;
      
      bot.sendMessage(userId, message);
      
      await RedisService.setUserState(userId, 'awaiting_journal_delete_number', validJournals);
      
    } catch (error) {
      console.error('Journal delete command error:', error);
      bot.sendMessage(userId, '❌ Unable to show journal entries.');
    }
  });

  // Balance Sheet command
  bot.onText(/\/balance_sheet/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /balance_sheet command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const balanceSheet = await LedgerService.generateBalanceSheet(userId);
      
      let message = `📊 BALANCE SHEET\nAs of: ${balanceSheet.as_of_date}\n\n`;
      
      message += `💰 ASSETS\n`;
      if (balanceSheet.assets.current.length > 0) {
        message += `Current Assets:\n`;
        balanceSheet.assets.current.forEach(asset => {
          message += `  ${asset.account_name}: RM${asset.balance.toFixed(2)}\n`;
        });
      }
      
      if (balanceSheet.assets.fixed.length > 0) {
        message += `Fixed Assets:\n`;
        balanceSheet.assets.fixed.forEach(asset => {
          message += `  ${asset.account_name}: RM${asset.balance.toFixed(2)}\n`;
        });
      }

      if (balanceSheet.assets.investment.length > 0) {
        message += `Investment Assets:\n`;
        balanceSheet.assets.investment.forEach(asset => {
          message += `  ${asset.account_name}: RM${asset.balance.toFixed(2)}\n`;
        });
      }
      
      message += `Total Assets: RM${balanceSheet.assets.total.toFixed(2)}\n\n`;
      
      message += `📋 LIABILITIES\n`;
      if (balanceSheet.liabilities.current.length > 0) {
        message += `Current Liabilities:\n`;
        balanceSheet.liabilities.current.forEach(liability => {
          message += `  ${liability.account_name}: RM${liability.balance.toFixed(2)}\n`;
        });
      }
      
      if (balanceSheet.liabilities.long_term.length > 0) {
        message += `Long-term Liabilities:\n`;
        balanceSheet.liabilities.long_term.forEach(liability => {
          message += `  ${liability.account_name}: RM${liability.balance.toFixed(2)}\n`;
        });
      }
      
      message += `Total Liabilities: RM${balanceSheet.liabilities.total.toFixed(2)}\n\n`;
      
      message += `🏛️ EQUITY\n`;
      balanceSheet.equity.items.forEach(equity => {
        message += `  ${equity.account_name}: RM${equity.balance.toFixed(2)}\n`;
      });
      
      message += `Total Equity: RM${balanceSheet.equity.total.toFixed(2)}\n\n`;
      
      message += `📈 SUMMARY\n`;
      message += `Total Liabilities + Equity: RM${balanceSheet.total_liabilities_equity.toFixed(2)}\n`;
      message += `Balanced: ${balanceSheet.is_balanced ? '✅' : '❌'}\n`;
      
      if (!balanceSheet.is_balanced) {
        message += `\n⚠️ Balance sheet is not balanced! Use /trial_balance to check.`;
      }
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Balance sheet error:', error);
      bot.sendMessage(userId, '❌ Unable to generate balance sheet. Please try again.');
    }
  });

  // Income Statement command
  bot.onText(/\/income_statement/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /income_statement command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const incomeStatement = await LedgerService.generateIncomeStatement(userId, startOfMonth, currentDate);
      
      let message = `📈 INCOME STATEMENT\n${incomeStatement.period}\n\n`;
      
      message += `💰 REVENUE\n`;
      if (incomeStatement.revenue.items.length > 0) {
        incomeStatement.revenue.items.forEach(item => {
          message += `  ${item.account_name}: RM${item.amount.toFixed(2)}\n`;
        });
      } else {
        message += `  No revenue recorded\n`;
      }
      message += `Total Revenue: RM${incomeStatement.revenue.total.toFixed(2)}\n\n`;
      
      if (incomeStatement.cogs.total > 0) {
        message += `📦 COST OF GOODS SOLD\n`;
        incomeStatement.cogs.items.forEach(item => {
          message += `  ${item.account_name}: RM${item.amount.toFixed(2)}\n`;
        });
        message += `Total COGS: RM${incomeStatement.cogs.total.toFixed(2)}\n\n`;
        message += `💎 GROSS PROFIT: RM${incomeStatement.gross_profit.toFixed(2)}\n\n`;
      }
      
      message += `💸 OPERATING EXPENSES\n`;
      if (incomeStatement.operating_expenses.items.length > 0) {
        incomeStatement.operating_expenses.items.forEach(item => {
          message += `  ${item.account_name}: RM${item.amount.toFixed(2)}\n`;
        });
      } else {
        message += `  No operating expenses recorded\n`;
      }
      message += `Total Operating Expenses: RM${incomeStatement.operating_expenses.total.toFixed(2)}\n\n`;
      
      message += `🏢 OPERATING INCOME: RM${incomeStatement.operating_income.toFixed(2)}\n\n`;
      
      if (incomeStatement.other_income.total > 0) {
        message += `📊 OTHER INCOME\n`;
        incomeStatement.other_income.items.forEach(item => {
          message += `  ${item.account_name}: RM${item.amount.toFixed(2)}\n`;
        });
        message += `Total Other Income: RM${incomeStatement.other_income.total.toFixed(2)}\n\n`;
      }
      
      if (incomeStatement.other_expenses.total > 0) {
        message += `📉 OTHER EXPENSES\n`;
        incomeStatement.other_expenses.items.forEach(item => {
          message += `  ${item.account_name}: RM${item.amount.toFixed(2)}\n`;
        });
        message += `Total Other Expenses: RM${incomeStatement.other_expenses.total.toFixed(2)}\n\n`;
      }
      
      message += `🎯 NET INCOME: RM${incomeStatement.net_income.toFixed(2)}\n`;
      
      // Add profitability ratios
      if (incomeStatement.revenue.total > 0) {
        const grossMargin = (incomeStatement.gross_profit / incomeStatement.revenue.total) * 100;
        const netMargin = (incomeStatement.net_income / incomeStatement.revenue.total) * 100;
        
        message += `\n📊 RATIOS\n`;
        message += `Gross Margin: ${grossMargin.toFixed(1)}%\n`;
        message += `Net Margin: ${netMargin.toFixed(1)}%\n`;
      }
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Income statement error:', error);
      bot.sendMessage(userId, '❌ Unable to generate income statement. Please try again.');
    }
  });

  // Cashflow Statement command
  bot.onText(/\/cashflow_statement/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /cashflow_statement command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const cashflowStatement = await LedgerService.generateCashflowStatement(userId, startOfMonth, currentDate);
      
      let message = `💧 CASHFLOW STATEMENT\n${cashflowStatement.period}\n\n`;
      
      message += `🏢 OPERATING ACTIVITIES\n`;
      cashflowStatement.operating_activities.items.forEach(item => {
        const sign = item.amount >= 0 ? '+' : '';
        message += `  ${item.description}: ${sign}RM${item.amount.toFixed(2)}\n`;
      });
      message += `Net Cash from Operating: RM${cashflowStatement.operating_activities.total.toFixed(2)}\n\n`;
      
      if (cashflowStatement.investing_activities.items.length > 0) {
        message += `🏗️ INVESTING ACTIVITIES\n`;
        cashflowStatement.investing_activities.items.forEach(item => {
          const sign = item.amount >= 0 ? '+' : '';
          message += `  ${item.description}: ${sign}RM${item.amount.toFixed(2)}\n`;
        });
        message += `Net Cash from Investing: RM${cashflowStatement.investing_activities.total.toFixed(2)}\n\n`;
      }
      
      if (cashflowStatement.financing_activities.items.length > 0) {
        message += `🏦 FINANCING ACTIVITIES\n`;
        cashflowStatement.financing_activities.items.forEach(item => {
          const sign = item.amount >= 0 ? '+' : '';
          message += `  ${item.description}: ${sign}RM${item.amount.toFixed(2)}\n`;
        });
        message += `Net Cash from Financing: RM${cashflowStatement.financing_activities.total.toFixed(2)}\n\n`;
      }
      
      message += `📊 SUMMARY\n`;
      message += `Net Change in Cash: RM${cashflowStatement.net_change_in_cash.toFixed(2)}\n`;
      message += `Beginning Cash: RM${cashflowStatement.beginning_cash.toFixed(2)}\n`;
      message += `Ending Cash: RM${cashflowStatement.ending_cash.toFixed(2)}\n`;
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Cashflow statement error:', error);
      bot.sendMessage(userId, '❌ Unable to generate cashflow statement. Please try again.');
    }
  });

  // Trial Balance command
  bot.onText(/\/trial_balance/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /trial_balance command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const trialBalance = await LedgerService.getTrialBalance(userId);
      
      let message = `⚖️ TRIAL BALANCE\nPeriod: ${trialBalance.period}\n\n`;
      
      if (trialBalance.accounts.length === 0) {
        message += `No account balances found.\n\nStart by adding transactions:\n• "Sales RM500"\n• "Paid rent RM800"`;
        bot.sendMessage(userId, message);
        return;
      }
      
      message += `Account                          Debit      Credit\n`;
      message += `${'='.repeat(50)}\n`;
      
      trialBalance.accounts.forEach(account => {
        const name = account.account_name.substring(0, 25).padEnd(25);
        const debit = account.debit_balance > 0 ? account.debit_balance.toFixed(2).padStart(10) : ''.padStart(10);
        const credit = account.credit_balance > 0 ? account.credit_balance.toFixed(2).padStart(10) : ''.padStart(10);
        
        message += `${account.account_code} ${name} ${debit} ${credit}\n`;
      });
      
      message += `${'='.repeat(50)}\n`;
      message += `TOTALS${' '.repeat(20)}${trialBalance.total_debits.toFixed(2).padStart(10)} ${trialBalance.total_credits.toFixed(2).padStart(10)}\n\n`;
      
      message += `Status: ${trialBalance.is_balanced ? '✅ Balanced' : '❌ Not Balanced'}\n`;
      
      if (!trialBalance.is_balanced) {
        const difference = Math.abs(trialBalance.total_debits - trialBalance.total_credits);
        message += `Difference: RM${difference.toFixed(2)}\n`;
      }
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Trial balance error:', error);
      bot.sendMessage(userId, '❌ Unable to generate trial balance. Please try again.');
    }
  });

  // Chart of Accounts command
  bot.onText(/\/chart_of_accounts/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /chart_of_accounts command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features are coming soon!');
      return;
    }
    
    const chartOfAccounts = LedgerService.chartOfAccounts;
    
    let message = `📋 CHART OF ACCOUNTS\n\n`;
    
    const categories = {
      'ASSETS': [],
      'LIABILITIES': [],
      'EQUITY': [],
      'REVENUE': [],
      'EXPENSES': []
    };
    
    Object.entries(chartOfAccounts).forEach(([code, account]) => {
      const item = `${code} - ${account.name}`;
      
      switch (account.type) {
        case 'asset':
          categories.ASSETS.push(item);
          break;
        case 'liability':
          categories.LIABILITIES.push(item);
          break;
        case 'equity':
          categories.EQUITY.push(item);
          break;
        case 'revenue':
          categories.REVENUE.push(item);
          break;
        case 'expense':
          categories.EXPENSES.push(item);
          break;
      }
    });
    
    Object.entries(categories).forEach(([category, accounts]) => {
      if (accounts.length > 0) {
        message += `💼 ${category}\n`;
        accounts.forEach(account => {
          message += `  ${account}\n`;
        });
        message += `\n`;
      }
    });
    
    message += `Use account codes in journal entries:\n`;
    message += `Example: "Dr 5100 RM800, Cr 1100 RM800"`;
    
    bot.sendMessage(userId, message);
  });

  // Transactions command
  bot.onText(/\/transactions/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /transactions command from user ${userId}`);
    
    try {
      const allTransactions = await RedisService.findAllUserTransactions(userId);
      const transactions = allTransactions.slice(0, 15);
      
      if (transactions.length === 0) {
        bot.sendMessage(userId, '📝 No transactions found.\n\nStart by adding one:\n• "Sales RM500"\n• "Paid rent RM800"');
        return;
      }
      
      let message = `📝 ALL TRANSACTIONS (${allTransactions.length} total)\n\n`;
      
      transactions.forEach((txn, index) => {
        const emoji = txn.type === 'income' ? '💰' : '💸';
        const date = new Date(txn.date).toLocaleDateString();
        const isRecurring = txn.description.includes('(Auto)') ? '🔄' : '';
        message += `${index + 1}. ${emoji}${isRecurring} ${txn.description}\n`;
        message += `   RM${txn.amount_myr} • ${txn.category} • ${date}\n\n`;
      });
      
      if (allTransactions.length > 15) {
        message += `... and ${allTransactions.length - 15} more transactions\n\n`;
      }
      
      message += `Commands: /search [term] | /delete | /trial_balance`;
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Transactions error:', error);
      bot.sendMessage(userId, '❌ Unable to load transactions.');
    }
  });

  // Search command
  bot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;
    const query = match && match[1];
    console.log(`📱 /search command from user ${userId}, query: ${query}`);
    
    if (!query) {
      bot.sendMessage(userId, `🔍 SEARCH TRANSACTIONS

EXAMPLES:
• /search rental
• /search RM800
• /search inventory

What would you like to search for?`);
      return;
    }
    
    try {
      const results = await RedisService.searchTransactions(userId, query);
      
      if (results.documents && results.documents.length > 0) {
        let message = `🔍 SEARCH RESULTS FOR "${query}"\n\n`;
        let total = 0;
        
        results.documents.slice(0, 10).forEach((doc, index) => {
          const txn = doc.value;
          const emoji = txn.type === 'income' ? '💰' : '💸';
          const date = new Date(txn.date).toLocaleDateString();
          message += `${index + 1}. ${emoji} ${txn.description}\n`;
          message += `   RM${txn.amount_myr} • ${txn.category} • ${date}\n\n`;
          total += txn.amount_myr;
        });
        
        message += `📊 Total Found: RM${total.toFixed(2)}`;
        
        bot.sendMessage(userId, message);
      } else {
        bot.sendMessage(userId, `🔍 No transactions found for "${query}"`);
      }
      
    } catch (error) {
      console.error('Search error:', error);
      bot.sendMessage(userId, '❌ Search failed. Please try again.');
    }
  });

  // Delete command
  bot.onText(/\/delete/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /delete command from user ${userId}`);
    
    try {
      const transactions = await RedisService.findAllUserTransactions(userId);
      
      if (transactions.length === 0) {
        bot.sendMessage(userId, '🗑️ No transactions to delete.');
        return;
      }
      
      let message = `🗑️ RECENT TRANSACTIONS\n\nReply with the number to delete:\n\n`;
      
      transactions.slice(0, 10).forEach((txn, index) => {
        const emoji = txn.type === 'income' ? '💰' : '💸';
        const date = new Date(txn.date).toLocaleDateString();
        const isRecurring = txn.description.includes('(Auto)') ? '🔄' : '';
        message += `${index + 1}. ${emoji}${isRecurring} ${txn.description} - RM${txn.amount_myr} (${date})\n`;
      });
      
      message += `\nType the number (1-${Math.min(10, transactions.length)}) to delete:`;
      
      bot.sendMessage(userId, message);
      
      await RedisService.setUserState(userId, 'awaiting_delete_number', transactions.slice(0, 10));
      
    } catch (error) {
      console.error('Delete command error:', error);
      bot.sendMessage(userId, '❌ Unable to show transactions.');
    }
  });

  // Export command
  bot.onText(/\/export/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /export command from user ${userId}`);
    
    bot.sendChatAction(userId, 'upload_document');
    
    try {
      const csv = await RedisService.exportTransactions(userId, 'csv');
      
      if (csv && csv.length > 0) {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const filename = `kheAI_accounting_${userId}_${Date.now()}.csv`;
        const tempFilePath = path.join(os.tmpdir(), filename);
        
        fs.writeFileSync(tempFilePath, csv);
        
        await bot.sendDocument(userId, tempFilePath, {
          caption: '📋 Your complete accounting records (CSV format)\n\nIncludes transactions and journal entries.'
        });
        
        fs.unlinkSync(tempFilePath);
        
      } else {
        bot.sendMessage(userId, '❌ No transactions to export.');
      }
    } catch (error) {
      console.error('Export error:', error);
      bot.sendMessage(userId, '❌ Export failed. Please try again.');
    }
  });

  // Assets commands
  bot.onText(/\/assets_list/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /assets_list command from user ${userId}`);
    
    if (!AssetService) {
      bot.sendMessage(userId, '💎 Asset management feature is coming soon!');
      return;
    }
    
    try {
      const assets = await AssetService.getUserAssets(userId);
      
      if (assets.length === 0) {
        bot.sendMessage(userId, '💎 No assets found.\n\nAdd one by typing: "Add Bitcoin RM2000"');
        return;
      }
      
      let message = `💎 YOUR ASSETS\n\nReply with number to delete:\n\n`;
      
      assets.forEach((asset, index) => {
        const categoryEmoji = asset.category === 'current' ? '💧' : 
                             asset.category === 'fixed' ? '🏔️' : '📈';
        message += `${index + 1}. ${categoryEmoji} ${asset.name}\n`;
        message += `   RM${asset.current_value_myr.toFixed(2)} • ${asset.type}\n\n`;
      });
      
      const totalValue = assets.reduce((sum, asset) => sum + asset.current_value_myr, 0);
      message += `💰 Total Value: RM${totalValue.toFixed(2)}\n\n`;
      message += `Commands: /assets_add | /assets_delete`;
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Assets list error:', error);
      bot.sendMessage(userId, '❌ Unable to load assets.');
    }
  });

  bot.onText(/\/assets_add/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /assets_add command from user ${userId}`);
    
    bot.sendMessage(userId, `💎 ADD ASSET

Type naturally:

EXAMPLES:
• "Add cash RM5000"
• "Add Bitcoin RM2000"
• "Add property RM500000"
• "Add stocks RM15000"

What asset would you like to add?`);
    
    await RedisService.setUserState(userId, 'awaiting_asset_input', 'general');
  });

  bot.onText(/\/assets_delete/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /assets_delete command from user ${userId}`);
    
    if (!AssetService) {
      bot.sendMessage(userId, '💎 Asset management feature is coming soon!');
      return;
    }
    
    try {
      const assets = await AssetService.getUserAssets(userId);
      
      if (assets.length === 0) {
        bot.sendMessage(userId, '💎 No assets to delete.\n\nAdd one first: "Add Bitcoin RM2000"');
        return;
      }
      
      let message = `💎 ALL ASSETS\n\nReply with the number to delete:\n\n`;
      
      assets.forEach((asset, index) => {
        const categoryEmoji = asset.category === 'current' ? '💧' : 
                             asset.category === 'fixed' ? '🏔️' : '📈';
        message += `${index + 1}. ${categoryEmoji} ${asset.name}\n`;
        message += `   RM${asset.current_value_myr} • ${asset.type}\n\n`;
      });
      
      message += `Type the number (1-${assets.length}) to delete:`;
      
      bot.sendMessage(userId, message);
      await RedisService.setUserState(userId, 'awaiting_asset_delete_number', assets);
      
    } catch (error) {
      console.error('Assets delete list error:', error);
      bot.sendMessage(userId, '❌ Unable to list assets for deletion.');
    }
  });

  // Liabilities commands
  bot.onText(/\/liabilities_list/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /liabilities_list command from user ${userId}`);
    
    if (!LiabilityService) {
      bot.sendMessage(userId, '📋 Liability management feature is coming soon!');
      return;
    }
    
    try {
      const liabilities = await LiabilityService.getUserLiabilities(userId);
      
      if (liabilities.length === 0) {
        bot.sendMessage(userId, '📋 No liabilities found.\n\nAdd one by typing: "Add loan RM5000"');
        return;
      }
      
      let message = `📋 YOUR LIABILITIES\n\nReply with number to delete:\n\n`;
      
      liabilities.forEach((liability, index) => {
        const categoryEmoji = liability.category === 'current' ? '⚡' : '🏛️';
        message += `${index + 1}. ${categoryEmoji} ${liability.name}\n`;
        message += `   RM${liability.current_balance_myr.toFixed(2)} • ${liability.type}\n\n`;
      });
      
      const totalLiabilities = liabilities.reduce((sum, liability) => sum + liability.current_balance_myr, 0);
      message += `💸 Total Liabilities: RM${totalLiabilities.toFixed(2)}\n\n`;
      message += `Commands: /liabilities_add | /liabilities_delete`;
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Liabilities list error:', error);
      bot.sendMessage(userId, '❌ Unable to load liabilities.');
    }
  });

  bot.onText(/\/liabilities_add/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /liabilities_add command from user ${userId}`);
    
    bot.sendMessage(userId, `📋 ADD LIABILITY

Type naturally:

EXAMPLES:
• "Add loan RM10000"
• "Add credit card RM2000"
• "Add mortgage RM300000"

What liability would you like to add?`);
    
    await RedisService.setUserState(userId, 'awaiting_liability_input', 'general');
  });

  bot.onText(/\/liabilities_delete/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /liabilities_delete command from user ${userId}`);
    
    if (!LiabilityService) {
      bot.sendMessage(userId, '📋 Liability management feature is coming soon!');
      return;
    }
    
    try {
      const liabilities = await LiabilityService.getUserLiabilities(userId);
      
      if (liabilities.length === 0) {
        bot.sendMessage(userId, '📋 No liabilities to delete.\n\nAdd one first: "Add loan RM10000"');
        return;
      }
      
      let message = `📋 ALL LIABILITIES\n\nReply with the number to delete:\n\n`;
      
      liabilities.forEach((liability, index) => {
        const categoryEmoji = liability.category === 'current' ? '⚡' : '🏛️';
        message += `${index + 1}. ${categoryEmoji} ${liability.name}\n`;
        message += `   RM${liability.current_balance_myr.toFixed(2)} • ${liability.type}\n\n`;
      });
      
      message += `Type the number (1-${liabilities.length}) to delete:`;
      
      bot.sendMessage(userId, message);
      
      await RedisService.setUserState(userId, 'awaiting_liability_delete_number', liabilities);
      
    } catch (error) {
      console.error('Liabilities delete list error:', error);
      bot.sendMessage(userId, '❌ Unable to list liabilities for deletion.');
    }
  });

  // Recurring commands
  bot.onText(/\/recurring_list/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /recurring_list command from user ${userId}`);
    
    if (!RecurringService) {
      bot.sendMessage(userId, '💫 Recurring transactions feature is coming soon!');
      return;
    }
    
    try {
      const activeRecurring = await RecurringService.getActiveRecurring(userId);
      
      if (activeRecurring.length === 0) {
        bot.sendMessage(userId, '💫 No active recurring transactions.\n\nCreate one by typing: "Monthly rent RM800"');
        return;
      }
      
      let message = `💫 ACTIVE RECURRING TRANSACTIONS\n\nReply with the number to delete:\n\n`;
      
      activeRecurring.forEach((recurring, index) => {
        const emoji = recurring.type === 'income' ? '💰' : '💸';
        const nextDue = new Date(recurring.next_due).toLocaleDateString();
        message += `${index + 1}. ${emoji} ${recurring.description}\n`;
        message += `   RM${recurring.amount_myr} • ${recurring.frequency} • Next: ${nextDue}\n\n`;
      });
      
      message += `Type the number (1-${activeRecurring.length}) to delete:`;
      
      bot.sendMessage(userId, message);
      
      await RedisService.setUserState(userId, 'awaiting_recurring_delete_number', activeRecurring);
      
    } catch (error) {
      console.error('Recurring list error:', error);
      bot.sendMessage(userId, '❌ Unable to list recurring transactions.');
    }
  });

  // Forecast command
  bot.onText(/\/forecast/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /forecast command from user ${userId}`);
    
    if (!CashflowService) {
      bot.sendMessage(userId, '📊 Cashflow forecasting feature is coming soon!');
      return;
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const forecast = await CashflowService.generateForecast(userId, 6);
      
      let message = `📊 CASHFLOW FORECAST (6 MONTHS)\n\n`;
      let cumulativeCash = 0;
      
      const metrics = await RedisService.getBusinessMetrics(userId);
      const currentRevenue = parseFloat(metrics.total_revenue || 0);
      const currentExpenses = parseFloat(metrics.total_expenses || 0);
      cumulativeCash = currentRevenue - currentExpenses;
      
      forecast.forEach((month, index) => {
        const netFlow = month.projected_income - month.projected_expenses;
        cumulativeCash += netFlow;
        const emoji = netFlow >= 0 ? '📈' : '📉';
        
        message += `${emoji} ${month.month}\n`;
        message += `   Income: RM${month.projected_income.toFixed(2)}\n`;
        message += `   Expenses: RM${month.projected_expenses.toFixed(2)}\n`;
        message += `   Net: RM${netFlow.toFixed(2)}\n\n`;
      });
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Forecast error:', error);
      bot.sendMessage(userId, '❌ Unable to generate forecast.');
    }
  });

  // Recovery command
  bot.onText(/\/recover/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /recover command from user ${userId}`);
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      bot.sendMessage(userId, '🔄 Starting recovery...');
      
      const allTransactions = await RedisService.findAllUserTransactions(userId);
      await RedisService.rebuildTransactionList(userId);
      const reconcileResult = await RedisService.reconcileBusinessMetrics(userId);
      
      bot.sendMessage(userId, `✅ RECOVERY COMPLETED!

🔍 Found: ${allTransactions.length} transactions
📊 Revenue: RM${reconcileResult.totalRevenue.toFixed(2)}
📊 Expenses: RM${reconcileResult.totalExpenses.toFixed(2)}

Try /transactions to see your data!`);
      
    } catch (error) {
      console.error('Recovery error:', error);
      bot.sendMessage(userId, '❌ Recovery failed. Please try again.');
    }
  });

  // Manual metrics fix command
  bot.onText(/\/fix_metrics/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /fix_metrics command from user ${userId}`);
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      bot.sendMessage(userId, '🔄 Fixing metrics...');
      
      await RedisService.rebuildTransactionList(userId);
      const reconcileResult = await RedisService.reconcileBusinessMetrics(userId);
      
      bot.sendMessage(userId, `✅ METRICS FIXED!

📊 Corrected Data:
• Transactions: ${reconcileResult.validTransactions}
• Revenue: RM${reconcileResult.totalRevenue.toFixed(2)}
• Expenses: RM${reconcileResult.totalExpenses.toFixed(2)}
• Net: RM${(reconcileResult.totalRevenue - reconcileResult.totalExpenses).toFixed(2)}

Try /insights now!`);
      
    } catch (error) {
      console.error('Fix metrics error:', error);
      bot.sendMessage(userId, '❌ Failed to fix metrics. Please try /recover');
    }
  });

  // Debug command
  bot.onText(/\/debug/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /debug command from user ${userId}`);
    
    try {
      let message = `🔍 SYSTEM STATUS\n\n`;
      
      message += `Services Available:\n`;
      message += `• RedisService: ✅\n`;
      message += `• AIService: ✅\n`;
      message += `• LedgerService: ${LedgerService ? '✅' : '❌'}\n`;
      message += `• RecurringService: ${RecurringService ? '✅' : '❌'}\n`;
      message += `• CashflowService: ${CashflowService ? '✅' : '❌'}\n`;
      message += `• AssetService: ${AssetService ? '✅' : '❌'}\n`;
      message += `• LiabilityService: ${LiabilityService ? '✅' : '❌'}\n\n`;
      
      const transactions = await RedisService.findAllUserTransactions(userId);
      const metrics = await RedisService.getBusinessMetrics(userId);
      
      message += `Your Data:\n`;
      message += `• Transactions: ${transactions.length}\n`;
      message += `• Revenue: RM${metrics.total_revenue || 0}\n`;
      message += `• Expenses: RM${metrics.total_expenses || 0}\n`;
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Debug error:', error);
      bot.sendMessage(userId, `❌ Debug failed: ${error.message}`);
    }
  });

  // Status command
  bot.onText(/\/status/, (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /status command from user ${userId}`);
    
    bot.sendMessage(userId, `🔍 SERVICE STATUS

✅ Core Bot: Working
✅ Redis: ${RedisService ? 'Working' : 'Error'}
✅ AI: ${AIService ? 'Working' : 'Error'}
${LedgerService ? '✅' : '❌'} Accounting: ${LedgerService ? 'Available' : 'Not Available'}
${RecurringService ? '✅' : '❌'} Recurring: ${RecurringService ? 'Available' : 'Not Available'}
${CashflowService ? '✅' : '❌'} Cashflow: ${CashflowService ? 'Available' : 'Not Available'}
${AssetService ? '✅' : '❌'} Assets: ${AssetService ? 'Available' : 'Not Available'}
${LiabilityService ? '✅' : '❌'} Liabilities: ${LiabilityService ? 'Available' : 'Not Available'}

Try /help for available commands.`);
  });

  // Remove keyboard command
  bot.onText(/\/remove_keyboard/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /remove_keyboard command from user ${userId}`);
    
    bot.sendMessage(userId, '✅ Custom keyboard removed. Use /help to see available commands.', {
      reply_markup: {
        remove_keyboard: true
      }
    });
  });

  // Debug balance sheet
  bot.onText(/\/debug_balance/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /debug_balance command from user ${userId}`);
    
    if (!LedgerService) {
      bot.sendMessage(userId, '📚 Accounting features not available');
      return;
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const trialBalance = await LedgerService.getTrialBalance(userId);
      const balanceSheet = await LedgerService.generateBalanceSheet(userId);
      
      let message = `🔍 BALANCE SHEET DEBUG\n\n`;
      
      message += `TRIAL BALANCE:\n`;
      message += `Total Debits: RM${trialBalance.total_debits.toFixed(2)}\n`;
      message += `Total Credits: RM${trialBalance.total_credits.toFixed(2)}\n`;
      message += `TB Balanced: ${trialBalance.is_balanced ? '✅' : '❌'}\n\n`;
      
      message += `BALANCE SHEET:\n`;
      message += `Total Assets: RM${balanceSheet.assets.total.toFixed(2)}\n`;
      message += `Total Liabilities: RM${balanceSheet.liabilities.total.toFixed(2)}\n`;
      message += `Total Equity: RM${balanceSheet.equity.total.toFixed(2)}\n`;
      message += `L + E Total: RM${balanceSheet.total_liabilities_equity.toFixed(2)}\n`;
      message += `BS Balanced: ${balanceSheet.is_balanced ? '✅' : '❌'}\n\n`;
      
      if (!balanceSheet.is_balanced) {
        const difference = balanceSheet.assets.total - balanceSheet.total_liabilities_equity;
        message += `DIFFERENCE: RM${difference.toFixed(2)}\n`;
        message += `This difference should be added to equity as current earnings.\n\n`;
      }
      
      message += `EQUITY BREAKDOWN:\n`;
      balanceSheet.equity.items.forEach(item => {
        message += `• ${item.account_name}: RM${item.balance.toFixed(2)}\n`;
      });
      
      bot.sendMessage(userId, message);
      
    } catch (error) {
      console.error('Debug balance error:', error);
      bot.sendMessage(userId, `❌ Debug failed: ${error.message}`);
    }
  });

  // Natural language processing with enhanced accounting features
  bot.onText(/^(?!\/|💰|💸|📊|🔍|🗑️|❓|💎|💫)(.+)/, async (msg) => {
    const userId = msg.from.id;
    const message = msg.text;
    console.log(`📱 Natural language from user ${userId}: ${message}`);
    
    // Check user state first
    try {
      const userState = await RedisService.getUserState(userId);
      if (userState && userState.state) {
        await handleUserState(bot, msg, userState);
        return;
      }
    } catch (error) {
      console.error('User state check error:', error);
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      // Check for recurring patterns
      const recurringKeywords = ['monthly', 'weekly', 'daily', 'yearly'];
      const isRecurringPattern = recurringKeywords.some(keyword => 
        message.toLowerCase().includes(keyword)
      );
      
      if (isRecurringPattern && RecurringService) {
        try {
          const parsedRecurring = await AIService.parseRecurringTransaction(message, userId);
          
          if (parsedRecurring && parsedRecurring.amount) {
            const recurring = await RecurringService.createRecurringTransaction(userId, parsedRecurring);
            
            bot.sendMessage(userId, `✅ RECURRING SETUP

💫 ${recurring.description}
💵 RM${recurring.amount_myr} • ${recurring.frequency}
📅 Next: ${new Date(recurring.next_due).toLocaleDateString()}

Use /recurring_list to manage recurring transactions.`);
            return;
          }
        } catch (error) {
          console.error('Recurring creation error:', error);
        }
      }
      
      // Check for asset patterns
      const assetKeywords = ['add cash', 'add bitcoin', 'add property', 'add stock'];
      const isAssetPattern = assetKeywords.some(keyword => 
        message.toLowerCase().includes(keyword)
      );
      
      if (isAssetPattern && AssetService) {
        try {
          const parsedAsset = await AIService.parseAsset(message, userId);
          
          if (parsedAsset && parsedAsset.value) {
            const asset = await AssetService.createAsset(userId, parsedAsset);
            
            bot.sendMessage(userId, `✅ ASSET ADDED

💎 ${asset.name}
💵 RM${asset.current_value_myr}
📂 ${asset.type} • ${asset.category}

Use /assets_list to view all assets.`);
            return;
          }
        } catch (error) {
          console.error('Asset creation error:', error);
        }
      }
      
      // Check for liability patterns
      const liabilityKeywords = ['add loan', 'add debt', 'add credit card', 'add mortgage'];
      const isLiabilityPattern = liabilityKeywords.some(keyword => 
        message.toLowerCase().includes(keyword)
      );
      
      if (isLiabilityPattern && LiabilityService) {
        try {
          const parsedLiability = await AIService.parseAssetOrLiability(message, userId, true);
          
          if (parsedLiability && parsedLiability.value) {
            const liability = await LiabilityService.createLiability(userId, {
              name: parsedLiability.name,
              type: parsedLiability.type,
              balance: parsedLiability.value,
              original_amount: parsedLiability.value
            });
            
            bot.sendMessage(userId, `✅ LIABILITY ADDED

📋 ${liability.name}
💵 RM${liability.current_balance_myr}
📂 ${liability.type} • ${liability.category}

Use /liabilities_list to view all liabilities.`);
            return;
          }
        } catch (error) {
          console.error('Liability creation error:', error);
        }
      }
      
      // Regular transaction processing with auto journal entries
      const parsedTransaction = await AIService.parseTransaction(message, userId);
      
      if (parsedTransaction && parsedTransaction.amount) {
        const transaction = await RedisService.createTransaction(userId, parsedTransaction);
        
        // AUTO-CREATE JOURNAL ENTRY
        let journalRef = 'N/A';
        try {
          if (LedgerService) {
            const journalEntry = await LedgerService.convertTransactionToJournalEntry(userId, transaction);
            journalRef = journalEntry.reference;
          }
        } catch (error) {
          console.error('Auto journal entry error:', error);
          journalRef = 'Manual entry needed';
        }
        
        const metrics = await RedisService.getBusinessMetrics(userId);
        const revenue = parseFloat(metrics.total_revenue || 0);
        const expenses = parseFloat(metrics.total_expenses || 0);
        const balance = revenue - expenses;
        
        const confirmationMessage = responses.transactionRecorded(transaction, balance, journalRef);
        
        bot.sendMessage(userId, confirmationMessage);
        
      } else {
        const hasAmount = /rm\s*\d+|\d+\s*rm|\d+/i.test(message);
        
        if (hasAmount) {
          bot.sendMessage(userId, responses.parseError);
        } else {
          try {
            const response = await AIService.processQueryEnhanced(userId, message);
            bot.sendMessage(userId, response);
          } catch (error) {
            console.error('AI query error:', error);
            bot.sendMessage(userId, responses.generalError);
          }
        }
      }
      
    } catch (error) {
      console.error('Message processing error:', error);
      bot.sendMessage(userId, responses.generalError);
    }
  });

  // Enhanced user state handling with journal entries
  async function handleUserState(bot, msg, userState) {
    const userId = msg.from.id;
    console.log(`📱 Handling user state: ${userState.state} for user ${userId}`);
    
    try {
      if (userState.state === 'awaiting_delete_number') {
        const number = parseInt(msg.text);
        const transactions = userState.data;
        
        if (number >= 1 && number <= transactions.length) {
          const txnToDelete = transactions[number - 1];
          const result = await RedisService.deleteTransaction(userId, txnToDelete.id);
          
          if (result.success) {
            bot.sendMessage(userId, `✅ Deleted: ${txnToDelete.description} (RM${txnToDelete.amount_myr})`);
          } else {
            bot.sendMessage(userId, `❌ Failed to delete transaction.`);
          }
        } else {
          bot.sendMessage(userId, `❌ Invalid number. Please choose 1-${transactions.length}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_recurring_delete_number') {
        const number = parseInt(msg.text);
        const recurringList = userState.data;
        
        if (number >= 1 && number <= recurringList.length) {
          const recurringToDelete = recurringList[number - 1];
          
          if (RecurringService) {
            const result = await RecurringService.deleteRecurring(userId, recurringToDelete.id);
            
            if (result.success) {
              bot.sendMessage(userId, `✅ Deleted recurring: ${recurringToDelete.description} (RM${recurringToDelete.amount_myr}, ${recurringToDelete.frequency})`);
            } else {
              bot.sendMessage(userId, `❌ Failed to delete recurring transaction.`);
            }
          } else {
            bot.sendMessage(userId, '💫 Recurring service not available.');
          }
        } else {
          bot.sendMessage(userId, `❌ Invalid number. Please choose 1-${recurringList.length}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_asset_delete_number') {
        const number = parseInt(msg.text);
        const assetList = userState.data;
        
        if (number >= 1 && number <= assetList.length) {
          const assetToDelete = assetList[number - 1];
          
          if (AssetService) {
            const result = await AssetService.deleteAsset(userId, assetToDelete.id);
            
            if (result.success) {
              bot.sendMessage(userId, `✅ Deleted asset: ${assetToDelete.name} (RM${assetToDelete.current_value_myr})`);
            } else {
              bot.sendMessage(userId, `❌ Failed to delete asset.`);
            }
          } else {
            bot.sendMessage(userId, '💎 Asset service not available.');
          }
        } else {
          bot.sendMessage(userId, `❌ Invalid number. Please choose 1-${assetList.length}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_liability_delete_number') {
        const number = parseInt(msg.text);
        const liabilityList = userState.data;
        
        if (number >= 1 && number <= liabilityList.length) {
          const liabilityToDelete = liabilityList[number - 1];
          
          if (LiabilityService) {
            const result = await LiabilityService.deleteLiability(userId, liabilityToDelete.id);
            
            if (result.success) {
              bot.sendMessage(userId, `✅ Deleted liability: ${liabilityToDelete.name} (RM${liabilityToDelete.current_balance_myr})`);
            } else {
              bot.sendMessage(userId, `❌ Failed to delete liability.`);
            }
          } else {
            bot.sendMessage(userId, '📋 Liability service not available.');
          }
        } else {
          bot.sendMessage(userId, `❌ Invalid number. Please choose 1-${liabilityList.length}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_asset_input') {
        if (AssetService) {
          try {
            const parsedAsset = await AIService.parseAsset(msg.text, userId);
            
            if (parsedAsset && parsedAsset.value) {
              const asset = await AssetService.createAsset(userId, parsedAsset);
              
              bot.sendMessage(userId, `✅ ASSET ADDED

💎 ${asset.name}
💵 RM${asset.current_value_myr}
📂 ${asset.type}

Use /assets_list to view all assets.`);
            } else {
              bot.sendMessage(userId, `❌ Could not parse asset. Try: "Add cash RM5000"`);
            }
          } catch (error) {
            console.error('Asset parsing error:', error);
            bot.sendMessage(userId, `❌ Failed to add asset. Try: "Add Bitcoin RM2000"`);
          }
        } else {
          bot.sendMessage(userId, '💎 Asset management feature is coming soon!');
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_liability_input') {
        if (LiabilityService) {
          try {
            const parsedLiability = await AIService.parseAssetOrLiability(msg.text, userId, true);
            
            if (parsedLiability && parsedLiability.value) {
              const liability = await LiabilityService.createLiability(userId, {
                name: parsedLiability.name,
                type: parsedLiability.type,
                balance: parsedLiability.value,
                original_amount: parsedLiability.value
              });
              
              bot.sendMessage(userId, `✅ LIABILITY ADDED

📋 ${liability.name}
💵 RM${liability.current_balance_myr}
📂 ${liability.type}

Use /liabilities_list to view all liabilities.`);
            } else {
              bot.sendMessage(userId, `❌ Could not parse liability. Try: "Add loan RM10000"`);
            }
          } catch (error) {
            console.error('Liability parsing error:', error);
            bot.sendMessage(userId, `❌ Failed to add liability. Try: "Add credit card RM2000"`);
          }
        } else {
          bot.sendMessage(userId, '📋 Liability management feature is coming soon!');
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_journal_entry') {
        if (!LedgerService) {
          bot.sendMessage(userId, '📚 Accounting features are coming soon!');
          await RedisService.clearUserState(userId);
          return;
        }
        
        try {
          const parsedJournal = await AIService.parseJournalEntry(msg.text, userId);
          
          if (parsedJournal && parsedJournal.lines) {
            const journalEntry = await LedgerService.createJournalEntry(userId, parsedJournal);
            
            bot.sendMessage(userId, `✅ JOURNAL ENTRY CREATED

📚 Reference: ${journalEntry.reference}
📝 Description: ${journalEntry.description}
💰 Amount: RM${journalEntry.total_debit.toFixed(2)}

ENTRIES:
${journalEntry.entries.map(entry => 
  `${entry.account_name}: Dr RM${entry.debit_amount.toFixed(2)} Cr RM${entry.credit_amount.toFixed(2)}`
).join('\n')}

Use /trial_balance to verify your books are balanced.`);
          } else {
            bot.sendMessage(userId, `❌ Could not parse journal entry.

Try these formats:
• "Paid rent RM800"
• "Received sales RM1500"
• "Dr 5100 RM800, Cr 1100 RM800"`);
          }
        } catch (error) {
          console.error('Journal entry creation error:', error);
          bot.sendMessage(userId, `❌ Failed to create journal entry: ${error.message}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_journal_view_number') {
        const number = parseInt(msg.text);
        const journalIds = userState.data;
        
        if (number >= 1 && number <= journalIds.length) {
          try {
            const journal = await redis.json.get(`journal:${journalIds[number - 1]}`);
            if (journal) {
              let message = `📚 JOURNAL ENTRY DETAILS\n\n`;
              message += `Reference: ${journal.reference}\n`;
              message += `Date: ${new Date(journal.date).toLocaleDateString()}\n`;
              message += `Description: ${journal.description}\n`;
              message += `Total: RM${journal.total_debit.toFixed(2)}\n\n`;
              
              message += `ENTRIES:\n`;
              journal.entries.forEach(entry => {
                message += `${entry.account_code} - ${entry.account_name}\n`;
                if (entry.debit_amount > 0) {
                  message += `  Debit: RM${entry.debit_amount.toFixed(2)}\n`;
                }
                if (entry.credit_amount > 0) {
                  message += `  Credit: RM${entry.credit_amount.toFixed(2)}\n`;
                }
                message += `\n`;
              });
              
              const isAuto = journal.reference.includes('TXN-') || journal.reference.includes('ASSET-') || journal.reference.includes('LIAB-');
              if (isAuto) {
                message += `🤖 This entry was auto-generated and cannot be edited.`;
              }
              
              bot.sendMessage(userId, message);
            }
          } catch (error) {
            console.error('Journal view error:', error);
            bot.sendMessage(userId, '❌ Unable to load journal entry.');
          }
        } else {
          bot.sendMessage(userId, `❌ Invalid number. Please choose 1-${journalIds.length}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_journal_delete_number') {
        const number = parseInt(msg.text);
        const journals = userState.data;
        
        if (number >= 1 && number <= journals.length) {
          const journalToDelete = journals[number - 1];
          
          try {
            // REVERSE THE JOURNAL ENTRY FROM LEDGER
            await reverseJournalFromLedger(userId, journalToDelete);
            
            // DELETE THE JOURNAL ENTRY
            await redis.del(`journal:${journalToDelete.id}`);
            await redis.lRem(`user:${userId}:journals`, 1, journalToDelete.id);
            
            bot.sendMessage(userId, `✅ Deleted journal entry: ${journalToDelete.description} (${journalToDelete.reference})`);
            
          } catch (error) {
            console.error('Journal deletion error:', error);
            bot.sendMessage(userId, `❌ Failed to delete journal entry.`);
          }
        } else {
          bot.sendMessage(userId, `❌ Invalid number. Please choose 1-${journals.length}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_journal_edit_number') {
        const number = parseInt(msg.text);
        const journals = userState.data;
        
        if (number >= 1 && number <= journals.length) {
          const journalToEdit = journals[number - 1];
          
          // Show current journal entry details
          let message = `📝 EDITING JOURNAL ENTRY\n\n`;
          message += `Reference: ${journalToEdit.reference}\n`;
          message += `Description: ${journalToEdit.description}\n`;
          message += `Date: ${new Date(journalToEdit.date).toLocaleDateString()}\n`;
          message += `Total: RM${journalToEdit.total_debit.toFixed(2)}\n\n`;
          
          message += `CURRENT ENTRIES:\n`;
          journalToEdit.entries.forEach((entry, index) => {
            message += `${index + 1}. ${entry.account_code} - ${entry.account_name}\n`;
            if (entry.debit_amount > 0) {
              message += `   Debit: RM${entry.debit_amount.toFixed(2)}\n`;
            }
            if (entry.credit_amount > 0) {
              message += `   Credit: RM${entry.credit_amount.toFixed(2)}\n`;
            }
          });
          
          message += `\n📝 EDIT OPTIONS:\n`;
          message += `1. Edit description\n`;
          message += `2. Edit account codes\n`;
          message += `3. Edit amounts\n`;
          message += `4. Replace entire entry\n`;
          message += `5. Cancel\n\n`;
          message += `What would you like to edit? (1-5):`;
          
          bot.sendMessage(userId, message);
          
          await RedisService.setUserState(userId, 'awaiting_journal_edit_option', journalToEdit);
          
        } else {
          bot.sendMessage(userId, `❌ Invalid number. Please choose 1-${journals.length}`);
          await RedisService.clearUserState(userId);
        }
      }
      
      else if (userState.state === 'awaiting_journal_edit_option') {
        const option = parseInt(msg.text);
        const journalToEdit = userState.data;
        
        switch (option) {
          case 1:
            bot.sendMessage(userId, `📝 EDIT DESCRIPTION\n\nCurrent: ${journalToEdit.description}\n\nEnter new description:`);
            await RedisService.setUserState(userId, 'awaiting_journal_edit_description', journalToEdit);
            break;
            
          case 2:
            bot.sendMessage(userId, `📝 EDIT ACCOUNT CODES\n\nCurrent entries:\n${journalToEdit.entries.map((e, i) => `${i+1}. ${e.account_code} - ${e.account_name}`).join('\n')}\n\nEnter new journal entry in format:\n"Dr 5100 RM800, Cr 1100 RM800 - description"`);
            await RedisService.setUserState(userId, 'awaiting_journal_edit_accounts', journalToEdit);
            break;
            
          case 3:
            bot.sendMessage(userId, `📝 EDIT AMOUNTS\n\nEnter new journal entry with updated amounts:\n"Dr 5100 RM[NEW_AMOUNT], Cr 1100 RM[NEW_AMOUNT] - ${journalToEdit.description}"`);
            await RedisService.setUserState(userId, 'awaiting_journal_edit_amounts', journalToEdit);
            break;
            
          case 4:
            bot.sendMessage(userId, `📝 REPLACE ENTIRE ENTRY\n\nEnter completely new journal entry:\n\nExamples:\n• "Paid rent RM800"\n• "Dr 5100 RM800, Cr 1100 RM800 - Monthly rent"\n\nWhat's the new entry?`);
            await RedisService.setUserState(userId, 'awaiting_journal_edit_replace', journalToEdit);
            break;
            
          case 5:
            bot.sendMessage(userId, '❌ Edit cancelled.');
            await RedisService.clearUserState(userId);
            break;
            
          default:
            bot.sendMessage(userId, '❌ Invalid option. Please choose 1-5.');
            break;
        }
      }
      
      else if (userState.state === 'awaiting_journal_edit_description') {
        const journalToEdit = userState.data;
        const newDescription = msg.text.trim();
        
        if (newDescription.length < 2) {
          bot.sendMessage(userId, '❌ Description too short. Please try again.');
          return;
        }
        
        try {
          // Update description only
          await redis.json.set(`journal:${journalToEdit.id}`, '$.description', newDescription);
          await redis.json.set(`journal:${journalToEdit.id}`, '$.updated_at', new Date().toISOString());
          
          bot.sendMessage(userId, `✅ DESCRIPTION UPDATED\n\nOld: ${journalToEdit.description}\nNew: ${newDescription}\n\nJournal entry ${journalToEdit.reference} has been updated.`);
          
        } catch (error) {
          console.error('Journal description edit error:', error);
          bot.sendMessage(userId, '❌ Failed to update description.');
        }
        
        await RedisService.clearUserState(userId);
      }
      
      else if (userState.state === 'awaiting_journal_edit_accounts' || 
               userState.state === 'awaiting_journal_edit_amounts' || 
               userState.state === 'awaiting_journal_edit_replace') {
        
        const journalToEdit = userState.data;
        
        try {
          // Parse the new journal entry
          const parsedJournal = await AIService.parseJournalEntry(msg.text, userId);
          
          if (parsedJournal && parsedJournal.lines) {
            // REVERSE the old journal entry from ledger
            await reverseJournalFromLedger(userId, journalToEdit);
            
            // Calculate new totals
            let totalDebit = 0;
            let totalCredit = 0;
            const newEntries = [];
            
            for (const line of parsedJournal.lines) {
              const lineEntry = {
                account_code: line.account_code,
                account_name: LedgerService.chartOfAccounts[line.account_code]?.name || 'Unknown Account',
                debit_amount: parseFloat(line.debit || 0),
                credit_amount: parseFloat(line.credit || 0),
                description: line.description || parsedJournal.description
              };
              
              newEntries.push(lineEntry);
              totalDebit += lineEntry.debit_amount;
              totalCredit += lineEntry.credit_amount;
            }
            
            // Validate double-entry
            if (Math.abs(totalDebit - totalCredit) > 0.01) {
              bot.sendMessage(userId, `❌ Journal entry not balanced!\nDebits: RM${totalDebit.toFixed(2)}\nCredits: RM${totalCredit.toFixed(2)}\n\nPlease try again.`);
              return;
            }
            
            // Update the journal entry
            const updatedJournal = {
              ...journalToEdit,
              description: parsedJournal.description || journalToEdit.description,
              total_debit: totalDebit,
              total_credit: totalCredit,
              entries: newEntries,
              updated_at: new Date().toISOString(),
              edited_by: 'user'
            };
            
            // Save updated journal
            await redis.json.set(`journal:${journalToEdit.id}`, '$', updatedJournal);
            
            // Apply new journal entry to ledger
            await LedgerService.updateGeneralLedger(userId, updatedJournal);
            
            bot.sendMessage(userId, `✅ JOURNAL ENTRY UPDATED\n\n📚 Reference: ${updatedJournal.reference}\n📝 Description: ${updatedJournal.description}\n💰 Amount: RM${updatedJournal.total_debit.toFixed(2)}\n\nNEW ENTRIES:\n${updatedJournal.entries.map(entry => 
              `${entry.account_name}: Dr RM${entry.debit_amount.toFixed(2)} Cr RM${entry.credit_amount.toFixed(2)}`
            ).join('\n')}\n\n✅ Ledger balances have been updated.\nUse /trial_balance to verify.`);
            
          } else {
            bot.sendMessage(userId, `❌ Could not parse journal entry.\n\nTry these formats:\n• "Paid rent RM800"\n• "Dr 5100 RM800, Cr 1100 RM800"`);
          }
          
        } catch (error) {
          console.error('Journal edit error:', error);
          bot.sendMessage(userId, `❌ Failed to update journal entry: ${error.message}`);
        }
        
        await RedisService.clearUserState(userId);
      }
      
    } catch (error) {
      console.error('User state handling error:', error);
      bot.sendMessage(userId, '❌ Something went wrong. Please try again.');
      await RedisService.clearUserState(userId);
    }
  }

  // Error handling
  bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
  });

  bot.on('error', (error) => {
    console.error('Bot error:', error);
  });

  // Background tasks
  if (RecurringService && typeof RecurringService.processDueRecurring === 'function') {
    setInterval(async () => {
      try {
        await RecurringService.processDueRecurring();
      } catch (error) {
        console.error('Recurring processing error:', error);
      }
    }, 60000);
    
    console.log('✅ Recurring processor started');
  }

  console.log('✅ kheAI Accounting Bot initialized successfully');
  console.log('🚀 Core Features: Transactions, Search, Delete, Export');
  console.log('📚 Accounting: Journal Entries, Financial Statements, Trial Balance');
  if (RecurringService) console.log('💫 Recurring: /recurring_list');
  if (CashflowService) console.log('📊 Cashflow: /forecast');
  if (AssetService) console.log('💎 Assets: /assets_list, /assets_add, /assets_delete');
  if (LiabilityService) console.log('📋 Liabilities: /liabilities_list, /liabilities_add, /liabilities_delete');
  console.log('🪙 Bitcoin Treasury: Natural language queries');
  console.log('🔧 Maintenance: /recover, /fix_metrics, /debug, /status');
}

module.exports = { initializeBot };