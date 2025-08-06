// src/bot/bot.js

const AIService = require('../services/ai');
const { RedisService } = require('../services/redis');

// Try to import enhanced services, but don't fail if they're not available
let RecurringService, CashflowService, AssetService;
try {
  RecurringService = require('../services/recurring');
} catch (e) {
  console.log('⚠️ RecurringService not available');
}
try {
  CashflowService = require('../services/cashflow');
} catch (e) {
  console.log('⚠️ CashflowService not available');
}
try {
  AssetService = require('../services/assets');
} catch (e) {
  console.log('⚠️ AssetService not available');
}

// Simple response templates
const responses = {
  welcome: `🎉 Welcome to kheAI Liquidity!

Your AI-powered liquidity management for Malaysian microbusinesses.

🔹 Track income & expenses via chat
🔹 Set up recurring transactions
🔹 Forecast cashflow (6 months)
🔹 Manage liquid assets
🔹 Bitcoin treasury advice

Try these commands:
/help - See all commands
/insights - Business analysis
/transactions - View recent transactions

Or just type naturally: "Beli inventory RM150" or "Sales RM500"`,

  welcomeBack: (name) => `Welcome back, ${name}! 👋

Ready to manage your liquidity?`,

  addIncomePrompt: `💰 ADD INCOME

Just tell me naturally:

EXAMPLES:
• "Sales RM500 today"
• "Received payment RM1200"
• "Rental income RM800"

Type your income below: 👇`,

  addExpensePrompt: `💸 ADD EXPENSE

Just tell me naturally:

EXAMPLES:
• "Beli inventory RM150"
• "Bayar rent RM800"
• "Petrol RM50"

Type your expense below: 👇`,

  transactionRecorded: (txn, balance) => `✅ TRANSACTION RECORDED

${txn.type === 'income' ? '💰' : '💸'} ${txn.description}
💵 Amount: RM${txn.amount_myr.toFixed(2)}
📂 Category: ${txn.category}
📅 Date: ${new Date(txn.date).toLocaleDateString()}

📊 Current Balance: RM${balance.toFixed(2)}`,

  parseError: `❌ I couldn't parse that transaction.

Try these formats:
• "Rental income RM800"
• "Sales RM500"
• "Beli inventory RM150"

Or ask me anything about your business! 🤖`,

  generalError: `❌ Sorry, I couldn't process that.

Try being more specific or use /help for available commands.`
};

function initializeBot(bot) {
  console.log('🚀 Initializing kheAI Bot...');

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
      bot.sendMessage(userId, 'Welcome! Ready to manage your business finances?', {
        reply_markup: {
          remove_keyboard: true
        }
      });
    }
  });

  // Help command
  bot.onText(/\/help/, (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /help command from user ${userId}`);
    
    bot.sendMessage(userId, `🤖 kheAI LIQUIDITY COMMANDS

💰 BASIC COMMANDS:
• Just type: "Sales RM500" or "Beli inventory RM150"
• /insights - Business analysis (auto-fixes metrics)
• /transactions - View ALL transactions
• /search [term] - Find transactions
• /delete - Remove transactions (choose by number)
• /export - Download CSV

💫 RECURRING TRANSACTIONS:
• /recurring_list - View & delete by number
• "Monthly rent RM800" - Create recurring

📊 ADVANCED FEATURES:
• /forecast - Cashflow projections
• /assets_list - View assets & delete option
• /assets_add - Add new asset
• /assets_delete - Delete assets by number

🪙 BITCOIN TREASURY:
• "Bitcoin price now?" - Current BTC + advice
• "Should I buy Bitcoin?" - Recommendations

🔧 MAINTENANCE:
• /recover - Fix missing transactions & metrics
• /debug - System status
• /status - Service availability
• /fix_metrics - Manual metric correction

EXAMPLES:
• "Rental income RM800"
• "Monthly utilities RM200"
• "Add Bitcoin RM2000"
• "Bitcoin price now?"

NEW FEATURES:
✅ Number-based deletion for everything
✅ Auto-metric fixing in /insights
✅ Asset deletion support
✅ Better transaction listing

Type naturally - I understand English and Malay!`);
  });

  // Insights command - FIXED with auto-reconciliation
  bot.onText(/\/insights?/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /insights command from user ${userId}`);
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      // Force reconciliation first to ensure correct metrics
      console.log(`🔄 Reconciling metrics for user ${userId} before insights`);
      await RedisService.reconcileBusinessMetrics(userId);
      
      // Get fresh metrics after reconciliation
      const metrics = await RedisService.getBusinessMetrics(userId);
      console.log(`📊 Metrics for user ${userId}:`, metrics);
      
      const revenue = parseFloat(metrics.total_revenue || 0);
      const expenses = parseFloat(metrics.total_expenses || 0);
      const profit = revenue - expenses;
      const profitMargin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0;
      
      // Get AI insights
      let insights = 'Generating insights...';
      try {
        insights = await AIService.generateInsights(userId);
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

AI INSIGHTS:
${insights}

📝 Total Transactions: ${metrics.transaction_count || 0}`;
      
      bot.sendMessage(userId, dashboardMessage);
      
    } catch (error) {
      console.error('Insights error:', error);
      bot.sendMessage(userId, '❌ Unable to generate insights. Try /recover first.');
    }
  });

  // Transactions command - FIXED to show all transactions
  bot.onText(/\/transactions/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /transactions command from user ${userId}`);
    
    try {
      // Use findAllUserTransactions instead of getRecentTransactions
      const allTransactions = await RedisService.findAllUserTransactions(userId);
      const transactions = allTransactions.slice(0, 15); // Show up to 15
      
      if (transactions.length === 0) {
        bot.sendMessage(userId, '📝 No transactions found.\n\nStart by adding one:\n• "Sales RM500"\n• "Beli inventory RM150"');
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
      
      message += `Use /search [term] to find specific transactions`;
      
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

  // Delete command - number-based selection
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
      
      // Store transactions for deletion reference
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
        
        const filename = `kheAI_transactions_${userId}_${Date.now()}.csv`;
        const tempFilePath = path.join(os.tmpdir(), filename);
        
        fs.writeFileSync(tempFilePath, csv);
        
        await bot.sendDocument(userId, tempFilePath, {
          caption: '📋 Your transaction history (CSV format)'
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

  // Recurring commands - FIXED with number-based deletion
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
      
      // Store recurring for deletion reference
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

  // Asset commands - UPDATED with deletion support
  bot.onText(/\/assets_list/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /assets_list command from user ${userId}`);
    
    if (!AssetService) {
      bot.sendMessage(userId, '💎 Asset management feature is coming soon!');
      return;
    }
    
    try {
      const breakdown = await AssetService.getLiquidityBreakdown(userId);
      const assets = await AssetService.getUserAssets(userId);
      
      if (breakdown.total_net_worth === 0) {
        bot.sendMessage(userId, '💎 No assets found.\n\nAdd one by typing: "Add Bitcoin RM2000"');
        return;
      }
      
      let message = `💎 ASSET BREAKDOWN\n\n` +
        `💧 Liquid: RM${breakdown.liquid.total.toFixed(2)} (${breakdown.liquid.assets.length} assets)\n` +
        `🌊 Semi-Liquid: RM${breakdown.semi_liquid.total.toFixed(2)} (${breakdown.semi_liquid.assets.length} assets)\n` +
        `🏔️ Illiquid: RM${breakdown.illiquid.total.toFixed(2)} (${breakdown.illiquid.assets.length} assets)\n\n` +
        `📊 Total: RM${breakdown.total_net_worth.toFixed(2)}\n` +
        `🌊 Liquidity Ratio: ${(breakdown.liquidity_ratio * 100).toFixed(1)}%\n\n`;
      
      if (assets.length > 0) {
        message += `DETAILED ASSETS:\n`;
        assets.forEach((asset, index) => {
          const liquidityEmoji = asset.category === 'liquid' ? '💧' : 
                               asset.category === 'semi_liquid' ? '🌊' : '🏔️';
          message += `${index + 1}. ${liquidityEmoji} ${asset.name} - RM${asset.current_value_myr}\n`;
        });
        
        message += `\nCommands:\n• /assets_add - Add new asset\n• /assets_delete - Delete asset`;
      }
      
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

  // NEW: Asset deletion command
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
        const liquidityEmoji = asset.category === 'liquid' ? '💧' : 
                             asset.category === 'semi_liquid' ? '🌊' : '🏔️';
        message += `${index + 1}. ${liquidityEmoji} ${asset.name}\n`;
        message += `   RM${asset.current_value_myr} • ${asset.type}\n\n`;
      });
      
      message += `Type the number (1-${assets.length}) to delete:`;
      
      bot.sendMessage(userId, message);
      
      // Store assets for deletion reference
      await RedisService.setUserState(userId, 'awaiting_asset_delete_number', assets);
      
    } catch (error) {
      console.error('Assets delete list error:', error);
      bot.sendMessage(userId, '❌ Unable to list assets for deletion.');
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

  // NEW: Manual metrics fix command
  bot.onText(/\/fix_metrics/, async (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /fix_metrics command from user ${userId}`);
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      bot.sendMessage(userId, '🔄 Fixing metrics...');
      
      // Rebuild everything
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
      
      // Check services
      message += `Services Available:\n`;
      message += `• RedisService: ✅\n`;
      message += `• AIService: ✅\n`;
      message += `• RecurringService: ${RecurringService ? '✅' : '❌'}\n`;
      message += `• CashflowService: ${CashflowService ? '✅' : '❌'}\n`;
      message += `• AssetService: ${AssetService ? '✅' : '❌'}\n\n`;
      
      // Check user data
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

  // NEW: Status command
  bot.onText(/\/status/, (msg) => {
    const userId = msg.from.id;
    console.log(`📱 /status command from user ${userId}`);
    
    bot.sendMessage(userId, `🔍 SERVICE STATUS

✅ Core Bot: Working
✅ Redis: ${RedisService ? 'Working' : 'Error'}
✅ AI: ${AIService ? 'Working' : 'Error'}
${RecurringService ? '✅' : '❌'} Recurring: ${RecurringService ? 'Available' : 'Not Available'}
${CashflowService ? '✅' : '❌'} Cashflow: ${CashflowService ? 'Available' : 'Not Available'}
${AssetService ? '✅' : '❌'} Assets: ${AssetService ? 'Available' : 'Not Available'}

Try /help for available commands.`);
  });

  // Natural language processing - SIMPLIFIED
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
📂 ${asset.type} • ${asset.liquidity_days} days

Use /assets_list to view all assets.`);
            return;
          }
        } catch (error) {
          console.error('Asset creation error:', error);
        }
      }
      
      // Regular transaction processing
      const parsedTransaction = await AIService.parseTransaction(message, userId);
      
      if (parsedTransaction && parsedTransaction.amount) {
        const transaction = await RedisService.createTransaction(userId, parsedTransaction);
        
        const metrics = await RedisService.getBusinessMetrics(userId);
        const revenue = parseFloat(metrics.total_revenue || 0);
        const expenses = parseFloat(metrics.total_expenses || 0);
        const balance = revenue - expenses;
        
        const confirmationMessage = responses.transactionRecorded(transaction, balance);
        
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

  // Handle user states - UPDATED with all deletion types
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

  // Background tasks - only if services are available
  if (RecurringService && typeof RecurringService.processDueRecurring === 'function') {
    setInterval(async () => {
      try {
        await RecurringService.processDueRecurring();
      } catch (error) {
        console.error('Recurring processing error:', error);
      }
    }, 60000); // Every minute
    
    console.log('✅ Recurring processor started');
  }

  console.log('✅ kheAI Bot initialized successfully');
  console.log('🚀 Available commands: /help, /insights, /transactions, /search, /delete, /export');
  if (RecurringService) console.log('💫 Recurring: /recurring_list');
  if (CashflowService) console.log('📊 Cashflow: /forecast');
  if (AssetService) console.log('💎 Assets: /assets_list, /assets_add, /assets_delete');
  console.log('🔧 Maintenance: /recover, /fix_metrics, /debug, /status');
}

module.exports = { initializeBot };