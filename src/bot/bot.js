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
            ['❓ Help']
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
            ['❓ Help']
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

  // Handle setup callbacks
  bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const data = query.data;
    
    if (data.startsWith('setup_')) {
      const businessType = data.replace('setup_', '');
      
      await RedisService.createUser(userId, {
        name: query.from.first_name || 'User',
        business_type: businessType,
        language: 'en'
      });
      
      bot.editMessageText(`✅ Business type set: ${businessType}

🚀 You're all set! Here's what you can do:

💬 Natural Language Bookkeeping:
Just type: "Beli inventory RM150" or "Sales RM500"

📊 Get Insights:
/insights - AI-powered business analysis

🔍 Search Transactions:
/search inventory - Find specific transactions

🧈 Bitcoin Treasury:
Ask me: "Should I buy Bitcoin this month?"

Ready to start? Try adding your first transaction! 💪`, {
        chat_id: userId,
        message_id: query.message.message_id
      });
    }
    
    bot.answerCallbackQuery(query.id);
  });

  // Quick action buttons
  bot.onText(/💰 Add Income|💸 Add Expense/, async (msg) => {
    const userId = msg.from.id;
    const isIncome = msg.text.includes('Income');
    
    bot.sendMessage(userId, `${isIncome ? '💰' : '💸'} **${isIncome ? 'Add Income' : 'Add Expense'}**

Just tell me naturally:

Examples:
${isIncome ? 
  '• "Sales RM500 today"\n• "Received payment RM1200"\n• "Cash sales RM350"' :
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
      
      bot.sendMessage(userId, `📊 **Business Dashboard**

This Month:
💰 Revenue: RM${revenue.toFixed(2)}
💸 Expenses: RM${expenses.toFixed(2)}
📈 Profit: RM${profit.toFixed(2)}
📊 Margin: ${profitMargin}%

AI Insights:
${insights}`);
      
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
      bot.sendMessage(userId, `🔍 **Search Transactions**

Examples:
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
        let message = `🔍 **Search Results for "${query}":**\n\n`;
        let total = 0;
        
        results.documents.slice(0, 10).forEach((doc, index) => {
          const txn = doc.value;
          const emoji = txn.type === 'income' ? '💰' : '💸';
          message += `${emoji} ${txn.description}\n`;
          message += `   RM${txn.amount_myr} • ${txn.category}\n\n`;
          total += txn.amount_myr;
        });
        
        message += `📊 **Total Found:** RM${total.toFixed(2)}`;
        
        bot.sendMessage(userId, message);
      } else {
        bot.sendMessage(userId, `🔍 No transactions found for "${query}"`);
      }
      
    } catch (error) {
      console.error('Search error:', error);
      bot.sendMessage(userId, '❌ Search failed. Please try again.');
    }
  });

  // Natural language transaction processing
  bot.onText(/^(?!\/|💰|💸|📊|🔍|❓)(.+)/, async (msg) => {
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
        
        bot.sendMessage(userId, `✅ **Transaction Recorded**

${transaction.type === 'income' ? '💰' : '💸'} **${transaction.description}**
💵 Amount: RM${transaction.amount_myr.toFixed(2)}
📂 Category: ${transaction.category}
📅 Date: ${new Date(transaction.date).toLocaleDateString()}

📊 Current Balance: RM${balance.toFixed(2)}`);
        
      } else {
        // Process as AI query
        const response = await AIService.processQuery(userId, message);
        bot.sendMessage(userId, response);
      }
      
    } catch (error) {
      console.error('Message processing error:', error);
      bot.sendMessage(userId, `❌ Sorry, I couldn't process that. 

Try being more specific:
• "Beli inventory RM150"
• "Sales RM500"
• "Rent payment RM800"

Or ask me anything about your business! 🤖`);
    }
  });

  // Help command
  bot.onText(/❓ Help|\/help/, (msg) => {
    const userId = msg.from.id;
    
    bot.sendMessage(userId, `🤖 kheAI Commands:

💰 Financial Management:
• Type naturally: "Beli stock RM200"
• /insights - Business analysis
• /search [term] - Find transactions

🧈 Bitcoin Treasury:
• Ask: "Bitcoin price today?"
• "Should I buy Bitcoin?"
• "Show my BTC allocation"

⚙️ Settings:
• /setup - Business profile
• /start - Restart bot

📊 Quick Actions:
• 💰 Add Income
• 💸 Add Expense  
• 📊 Insights
• 🔍 Search

Just chat with me naturally! I understand both English and Bahasa Malaysia. 🇲🇾`);
  });

  // Error handling
  bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
  });

  bot.on('error', (error) => {
    console.error('Bot error:', error);
  });
}

module.exports = { initializeBot };