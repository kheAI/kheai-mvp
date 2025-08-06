const AIService = require('../services/ai');
const { RedisService } = require('../services/redis');

function initializeBot(bot) {
  // Welcome & Onboarding
  bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const user = await RedisService.getUser(userId);
    
    if (!user.id) {
      await RedisService.createUser(userId, {
        name: msg.from.first_name || 'User',
        language: 'en'
      });
      
      bot.sendMessage(userId, `🎉 Welcome to kheAI!

I'm your AI-powered bookkeeper for Malaysian microbusinesses.

🔹 Track expenses & income via chat
🔹 Get Bitcoin treasury advice  
🔹 Real-time business insights
🔹 Malaysian tax guidance

Try these commands:
/setup - Configure your business
/insights - Get business analysis
/help - See all commands

Or just type naturally: "Beli inventory RM150"`, {
        reply_markup: {
          keyboard: [
            ['💰 Add Income', '💸 Add Expense'],
            ['📊 Insights', '🔍 Search'],
            ['🗑️ Delete', '❓ Help']
          ],
          resize_keyboard: true
        }
      });
    } else {
      bot.sendMessage(userId, `Welcome back, ${user.name}! 👋

Ready to manage your business finances?`, {
        reply_markup: {
          keyboard: [
            ['💰 Add Income', '💸 Add Expense'],
            ['📊 Insights', '🔍 Search'],
            ['🗑️ Delete', '❓ Help']
          ],
          resize_keyboard: true
        }
      });
    }
  });

  // Business Setup
  bot.onText(/\/setup/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendMessage(userId, `🏪 Let's set up your business profile:

What type of business do you run?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 Retail/Kedai', callback_data: 'setup_retail' }],
          [{ text: '🍽️ F&B/Restaurant', callback_data: 'setup_fnb' }],
          [{ text: '🔧 Services', callback_data: 'setup_services' }],
          [{ text: '📦 E-commerce', callback_data: 'setup_ecommerce' }],
          [{ text: '📋 Other', callback_data: 'setup_other' }]
        ]
      }
    });
  });

  // Quick action buttons
  bot.onText(/💰 Add Income|💸 Add Expense/, async (msg) => {
    const userId = msg.from.id;
    const isIncome = msg.text.includes('Income');
    
    bot.sendMessage(userId, `${isIncome ? '💰' : '💸'} ${isIncome ? 'ADD INCOME' : 'ADD EXPENSE'}

Just tell me naturally:

EXAMPLES:
${isIncome ? 
  '• "Sales RM500 today"\n• "Received payment RM1200"\n• "Rental income RM800"' :
  '• "Beli inventory RM150"\n• "Bayar rent RM800"\n• "Petrol RM50"'
}

Type your transaction below: 👇`);
  });

  // Insights command
  bot.onText(/📊 Insights|\/insights/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const metrics = await RedisService.getBusinessMetrics(userId);
      const insights = await AIService.generateInsights(userId);
      
      const revenue = parseFloat(metrics.total_revenue || 0);
      const expenses = parseFloat(metrics.total_expenses || 0);
      const profit = revenue - expenses;
      const profitMargin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0;
      
      // Format message for Telegram (no markdown)
      const dashboardMessage = `📊 BUSINESS DASHBOARD

THIS MONTH:
💰 Revenue: RM${revenue.toFixed(2)}
💸 Expenses: RM${expenses.toFixed(2)}
📈 Profit: RM${profit.toFixed(2)}
📊 Margin: ${profitMargin}%

AI INSIGHTS:
${insights}`;
      
      bot.sendMessage(userId, dashboardMessage);
      
    } catch (error) {
      console.error('Insights error:', error);
      bot.sendMessage(userId, '❌ Unable to generate insights. Please try again.');
    }
  });

  // Search command
  bot.onText(/🔍 Search|\/search(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;
    const query = match && match[1];
    
    if (!query) {
      bot.sendMessage(userId, `🔍 SEARCH TRANSACTIONS

EXAMPLES:
• /search inventory
• /search rent  
• /search RM500

What would you like to search for?`);
      return;
    }
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const results = await RedisService.searchTransactions(userId, query);
      
      if (results.documents && results.documents.length > 0) {
        let message = `🔍 SEARCH RESULTS FOR "${query}"\n\n`;
        let total = 0;
        
        results.documents.slice(0, 10).forEach((doc, index) => {
          const txn = doc.value;
          const emoji = txn.type === 'income' ? '💰' : '💸';
          message += `${emoji} ${txn.description}\n`;
          message += `   RM${txn.amount_myr} • ${txn.category}\n\n`;
          total += txn.amount_myr;
        });
        
        message += `📊 Total Found: RM${total.toFixed(2)}`;
        
        if (results.documents.length > 10) {
          message += `\n\nShowing first 10 of ${results.documents.length} results`;
        }
        
        bot.sendMessage(userId, message);
      } else {
        bot.sendMessage(userId, `🔍 No transactions found for "${query}"

Try searching for:
• Category names (inventory, rent, sales)
• Amounts (RM100, RM500)
• Descriptions (supplier, customer)`);
      }
      
    } catch (error) {
      console.error('Search error:', error);
      bot.sendMessage(userId, '❌ Search failed. Please try again.');
    }
  });

  // Delete transactions command
  bot.onText(/🗑️ Delete|\/delete/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      // Use findAllUserTransactions to show ALL transactions
      const transactions = await RedisService.findAllUserTransactions(userId);
      
      if (transactions.length === 0) {
        bot.sendMessage(userId, `🗑️ No transactions to delete.

Add some transactions first:
• "Sales RM500"
• "Beli inventory RM150"`);
        return;
      }
      
      let message = `🗑️ ALL TRANSACTIONS

Select a transaction to delete:

`;
      
      const keyboard = [];
      transactions.slice(0, 15).forEach((txn, index) => { // Show up to 15 transactions
        const emoji = txn.type === 'income' ? '💰' : '💸';
        const date = new Date(txn.date).toLocaleDateString();
        message += `${index + 1}. ${emoji} ${txn.description} - RM${txn.amount_myr} (${date})\n`;
        
        keyboard.push([{
          text: `🗑️ Delete #${index + 1}`,
          callback_data: `delete_${txn.id}`
        }]);
      });
      
      if (transactions.length > 15) {
        message += `\n... and ${transactions.length - 15} more transactions`;
      }
      
      bot.sendMessage(userId, message, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
      
    } catch (error) {
      console.error('Delete list error:', error);
      bot.sendMessage(userId, '❌ Unable to show transactions. Please try again.');
    }
  });

  // Undo last transaction command
  bot.onText(/\/undo/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const transactions = await RedisService.findAllUserTransactions(userId);
      
      if (transactions.length === 0) {
        bot.sendMessage(userId, '🗑️ No transactions to undo.');
        return;
      }
      
      const lastTransaction = transactions[0]; // First one is newest
      const emoji = lastTransaction.type === 'income' ? '💰' : '💸';
      
      bot.sendMessage(userId, `🗑️ UNDO LAST TRANSACTION

${emoji} ${lastTransaction.description}
💵 Amount: RM${lastTransaction.amount_myr}
📅 Date: ${new Date(lastTransaction.date).toLocaleDateString()}

Are you sure you want to delete this transaction?`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Delete', callback_data: `confirm_delete_${lastTransaction.id}` },
              { text: '❌ Cancel', callback_data: 'cancel_delete' }
            ]
          ]
        }
      });
      
    } catch (error) {
      console.error('Undo error:', error);
      bot.sendMessage(userId, '❌ Unable to undo. Please try again.');
    }
  });

  // Recovery command
  bot.onText(/\/recover/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      bot.sendMessage(userId, '🔄 STARTING RECOVERY PROCESS...\n\nThis may take a moment...');
      
      // Step 1: Find all transactions
      const allTransactions = await RedisService.findAllUserTransactions(userId);
      
      // Step 2: Rebuild transaction list
      await RedisService.rebuildTransactionList(userId);
      
      // Step 3: Reconcile metrics
      const reconcileResult = await RedisService.reconcileBusinessMetrics(userId);
      
      bot.sendMessage(userId, `✅ RECOVERY COMPLETED!

🔍 FOUND TRANSACTIONS:
• Total found: ${allTransactions.length}
• In metrics: ${reconcileResult.validTransactions}

📊 CORRECTED METRICS:
• Revenue: RM${reconcileResult.totalRevenue.toFixed(2)}
• Expenses: RM${reconcileResult.totalExpenses.toFixed(2)}
• Net: RM${(reconcileResult.totalRevenue - reconcileResult.totalExpenses).toFixed(2)}

🎉 All your rental income transactions should now be visible!

Try:
• /delete - to see all transactions
• /export - to download complete CSV
• /insights - to see corrected dashboard`);
      
    } catch (error) {
      console.error('Recovery command error:', error);
      bot.sendMessage(userId, '❌ Recovery failed. Please contact support.');
    }
  });

  // Reconcile command (for fixing metrics)
  bot.onText(/\/reconcile/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const result = await RedisService.reconcileBusinessMetrics(userId);
      
      bot.sendMessage(userId, `🔄 METRICS RECONCILED

✅ Fixed business dashboard numbers:
• Valid transactions: ${result.validTransactions}
• Revenue: RM${result.totalRevenue.toFixed(2)}
• Expenses: RM${result.totalExpenses.toFixed(2)}
• Profit: RM${(result.totalRevenue - result.totalExpenses).toFixed(2)}

Your dashboard should now show correct numbers!`);
      
    } catch (error) {
      console.error('Reconcile command error:', error);
      bot.sendMessage(userId, '❌ Reconciliation failed. Please try again.');
    }
  });

  // Export command (with recovery)
  bot.onText(/\/export/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendChatAction(userId, 'upload_document');
    
    try {
      // Auto-recovery before export to ensure we get ALL transactions
      await RedisService.rebuildTransactionList(userId);
      
      const csv = await RedisService.exportTransactions(userId, 'csv');
      
      if (csv && csv.length > 0) {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        // Create temporary file
        const filename = `kheAI_transactions_${userId}_${Date.now()}.csv`;
        const tempFilePath = path.join(os.tmpdir(), filename);
        
        // Write CSV to temporary file
        fs.writeFileSync(tempFilePath, csv);
        
        // Send the file
        await bot.sendDocument(userId, tempFilePath, {
          caption: '📋 Your complete transaction history (CSV format)\n\nAll transactions included after recovery.'
        });
        
        // Clean up temporary file
        fs.unlinkSync(tempFilePath);
        
      } else {
        bot.sendMessage(userId, '❌ No transactions to export.');
      }
    } catch (error) {
      console.error('Export error:', error);
      bot.sendMessage(userId, '❌ Export failed. Please try again.');
    }
  });

  // Cleanup command (for debugging)
  bot.onText(/\/cleanup/, async (msg) => {
    const userId = msg.from.id;
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      const validCount = await RedisService.cleanupTransactionList(userId);
      
      bot.sendMessage(userId, `🧹 CLEANUP COMPLETED

✅ Found ${validCount} valid transactions
🗑️ Removed invalid references

Your transaction list is now clean!

Try /export again to get only valid transactions.`);
      
    } catch (error) {
      console.error('Cleanup command error:', error);
      bot.sendMessage(userId, '❌ Cleanup failed. Please try again.');
    }
  });

  // Natural language transaction processing
  bot.onText(/^(?!\/|💰|💸|📊|🔍|🗑️|❓)(.+)/, async (msg) => {
    const userId = msg.from.id;
    const message = msg.text;
    
    bot.sendChatAction(userId, 'typing');
    
    try {
      // Try to parse as transaction first
      const parsedTransaction = await AIService.parseTransaction(message, userId);
      
      if (parsedTransaction && parsedTransaction.amount) {
        // Create transaction
        const transaction = await RedisService.createTransaction(userId, parsedTransaction);
        
        // Get updated balance
        const metrics = await RedisService.getBusinessMetrics(userId);
        const revenue = parseFloat(metrics.total_revenue || 0);
        const expenses = parseFloat(metrics.total_expenses || 0);
        const balance = revenue - expenses;
        
        // Clean Telegram formatting
        const confirmationMessage = `✅ TRANSACTION RECORDED

${transaction.type === 'income' ? '💰' : '💸'} ${transaction.description}
💵 Amount: RM${transaction.amount_myr.toFixed(2)}
📂 Category: ${transaction.category}
📅 Date: ${new Date(transaction.date).toLocaleDateString()}

📊 Current Balance: RM${balance.toFixed(2)}`;
        
        bot.sendMessage(userId, confirmationMessage, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 View Insights', callback_data: 'show_insights' }],
              [{ text: '🔍 Search Similar', callback_data: `search_${transaction.category}` }],
              [{ text: '🗑️ Delete This', callback_data: `delete_${transaction.id}` }]
            ]
          }
        });
        
      } else {
        // Check if it looks like a transaction but failed to parse
        const hasAmount = /rm\s*\d+|\d+\s*rm|\d+/i.test(message);
        
        if (hasAmount) {
          // Looks like a transaction but failed to parse
          bot.sendMessage(userId, `❌ I couldn't parse that transaction.

Try these formats:
• "Rental income RM800"
• "Received rental RM800"
• "Sales RM500"
• "Beli inventory RM150"
• "Bayar rent RM800"

Or ask me anything about your business! 🤖`);
        } else {
          // Process as AI query with enhanced handling
          const response = await AIService.processQueryEnhanced(userId, message);
          bot.sendMessage(userId, response);
        }
      }
      
    } catch (error) {
      console.error('Message processing error:', error);
      bot.sendMessage(userId, `❌ Sorry, I couldn't process that.

Try being more specific:
• "Rental income RM800"
• "Sales RM500" 
• "Beli inventory RM150"
• "Bitcoin price now?"
• "How to buy Bitcoin safely?"

Or ask me anything about your business! 🤖`);
    }
  });

  // Help command (updated with recovery)
  bot.onText(/❓ Help|\/help/, (msg) => {
    const userId = msg.from.id;
    
    bot.sendMessage(userId, `🤖 kheAI COMMANDS

💰 FINANCIAL MANAGEMENT:
• Type naturally: "Beli stock RM200"
• /insights - Business analysis
• /search [term] - Find transactions
• /delete - Remove wrong transactions
• /undo - Delete last transaction
• /export - Download CSV

🔧 RECOVERY & MAINTENANCE:
• /recover - Find and restore lost transactions
• /reconcile - Fix dashboard numbers
• /cleanup - Fix transaction list

🪙 BITCOIN TREASURY:
• "Bitcoin price now?" - Current BTC price + advice
• "Should I buy Bitcoin?" - Allocation recommendations
• "How to buy Bitcoin safely?" - Security guidance

⚙️ SETTINGS:
• /setup - Business profile
• /start - Restart bot

📊 QUICK ACTIONS:
• 💰 Add Income
• 💸 Add Expense  
• 📊 Insights
• 🔍 Search
• 🗑️ Delete

EXAMPLE QUERIES:
• "Rental income RM800"
• "Bitcoin price now?"
• "Beli inventory RM150"

🆘 HAVING ISSUES?
• /recover - Restore missing transactions
• /reconcile - Fix incorrect dashboard numbers
• /cleanup - Clean up transaction list

Just chat with me naturally! I understand both English and Bahasa Malaysia. 🇲🇾`);
  });

  // Handle all callback queries
  bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const data = query.data;
    
    try {
      // Setup callbacks
      if (data.startsWith('setup_')) {
        const businessType = data.replace('setup_', '');
        
        await RedisService.createUser(userId, {
          name: query.from.first_name || 'User',
          business_type: businessType,
          language: 'en'
        });
        
        bot.editMessageText(`✅ Business type set: ${businessType}

🚀 You're all set! Here's what you can do:

💬 NATURAL LANGUAGE BOOKKEEPING:
Just type: "Beli inventory RM150" or "Sales RM500"

📊 GET INSIGHTS:
/insights - AI-powered business analysis

🔍 SEARCH TRANSACTIONS:
/search inventory - Find specific transactions

🪙 BITCOIN TREASURY:
Ask me: "Should I buy Bitcoin this month?"

Ready to start? Try adding your first transaction! 💪`, {
          chat_id: userId,
          message_id: query.message.message_id
        });
      }
      
      // Show insights callback
      if (data === 'show_insights') {
        bot.sendChatAction(userId, 'typing');
        
        const metrics = await RedisService.getBusinessMetrics(userId);
        const insights = await AIService.generateInsights(userId);
        
        const revenue = parseFloat(metrics.total_revenue || 0);
        const expenses = parseFloat(metrics.total_expenses || 0);
        const profit = revenue - expenses;
        const profitMargin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0;
        
        const dashboardMessage = `📊 BUSINESS DASHBOARD

THIS MONTH:
💰 Revenue: RM${revenue.toFixed(2)}
💸 Expenses: RM${expenses.toFixed(2)}
📈 Profit: RM${profit.toFixed(2)}
📊 Margin: ${profitMargin}%

AI INSIGHTS:
${insights}`;
        
        bot.sendMessage(userId, dashboardMessage);
      }
      
      // Search similar transactions callback
      if (data.startsWith('search_')) {
        const category = data.replace('search_', '');
        bot.sendChatAction(userId, 'typing');
        
        const results = await RedisService.searchTransactions(userId, category);
        
        if (results.documents && results.documents.length > 0) {
          let message = `🔍 ${category.toUpperCase()} TRANSACTIONS\n\n`;
          
          results.documents.forEach((doc, index) => {
            const txn = doc.value;
            message += `${index + 1}. ${txn.description} - RM${txn.amount_myr}\n`;
          });
          
          bot.sendMessage(userId, message);
        } else {
          bot.sendMessage(userId, `No ${category} transactions found.`);
        }
      }

      // Delete transaction callbacks
      if (data.startsWith('delete_')) {
        const transactionId = data.replace('delete_', '');
        
        // Get transaction details for confirmation using findAllUserTransactions
        const allTransactions = await RedisService.findAllUserTransactions(userId);
        const txn = allTransactions.find(t => t.id === transactionId);
        
        if (!txn) {
          bot.sendMessage(userId, '❌ Transaction not found.');
          return;
        }
        
        const emoji = txn.type === 'income' ? '💰' : '💸';
        
        bot.editMessageText(`🗑️ CONFIRM DELETION

${emoji} ${txn.description}
💵 Amount: RM${txn.amount_myr}
📅 Date: ${new Date(txn.date).toLocaleDateString()}

⚠️ This action cannot be undone. Are you sure?`, {
          chat_id: userId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Yes, Delete', callback_data: `confirm_delete_${transactionId}` },
                { text: '❌ Cancel', callback_data: 'cancel_delete' }
              ]
            ]
          }
        });
      }
      
      // Confirm deletion
      if (data.startsWith('confirm_delete_')) {
        const transactionId = data.replace('confirm_delete_', '');
        
        const result = await RedisService.deleteTransaction(userId, transactionId);
        
        if (result.success) {
          const transaction = result.transaction;
          const emoji = transaction.type === 'income' ? '💰' : '💸';
          
          // Get updated balance after reconciliation
          await RedisService.reconcileBusinessMetrics(userId);
          const metrics = await RedisService.getBusinessMetrics(userId);
          const revenue = parseFloat(metrics.total_revenue || 0);
          const expenses = parseFloat(metrics.total_expenses || 0);
          const balance = revenue - expenses;
          
          bot.editMessageText(`✅ TRANSACTION DELETED

${emoji} ${transaction.description}
💵 Amount: RM${transaction.amount_myr}

📊 Updated Balance: RM${balance.toFixed(2)}

The transaction has been removed from your records.`, {
            chat_id: userId,
            message_id: query.message.message_id
          });
        } else {
          bot.editMessageText(`❌ Failed to delete transaction: ${result.error}`, {
            chat_id: userId,
            message_id: query.message.message_id
          });
        }
      }
      
      // Cancel deletion
      if (data === 'cancel_delete') {
        bot.editMessageText(`❌ Deletion cancelled.

Your transaction remains in the records.`, {
          chat_id: userId,
          message_id: query.message.message_id
        });
      }

      // Export CSV callback
      if (data === 'export_csv') {
        bot.sendChatAction(userId, 'upload_document');
        
        try {
          // Auto-recovery before export
          await RedisService.rebuildTransactionList(userId);
          
          const csv = await RedisService.exportTransactions(userId, 'csv');
          
          if (csv && csv.length > 0) {
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            
            // Create temporary file
            const filename = `kheAI_transactions_${userId}_${Date.now()}.csv`;
            const tempFilePath = path.join(os.tmpdir(), filename);
            
            // Write CSV to temporary file
            fs.writeFileSync(tempFilePath, csv);
            
            // Send the file
            await bot.sendDocument(userId, tempFilePath, {
              caption: '📋 Your complete transaction history exported successfully!'
            });
            
            // Clean up temporary file
            fs.unlinkSync(tempFilePath);
            
          } else {
            bot.sendMessage(userId, '❌ No transactions to export.');
          }
        } catch (error) {
          console.error('Export CSV error:', error);
          bot.sendMessage(userId, '❌ Export failed. Please try again.');
        }
      }
      
    } catch (error) {
      console.error('Callback query error:', error);
      bot.sendMessage(userId, '❌ Something went wrong. Please try again.');
    }
    
    bot.answerCallbackQuery(query.id);
  });

  // Error handling
  bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
  });

  bot.on('error', (error) => {
    console.error('Bot error:', error);
  });

  console.log('✅ Bot handlers initialized');
}

module.exports = { initializeBot };