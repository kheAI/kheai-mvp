// src/services/cashflow.js

const redis = require('../../config/redis');
const { RedisService } = require('./redis');
const RecurringService = require('./recurring');
const AssetService = require('./assets');

class CashflowService {
  async generateForecast(userId, months = 6) {
    try {
      const forecast = [];
      const currentDate = new Date();
      
      // Get historical data for baseline
      const historicalData = await this.getHistoricalData(userId, 6);
      const recurringTransactions = await RecurringService.getActiveRecurring(userId);
      const futureTransactions = await this.getFutureTransactions(userId);
      
      for (let i = 0; i < months; i++) {
        const forecastDate = new Date(currentDate);
        forecastDate.setMonth(forecastDate.getMonth() + i);
        
        const monthForecast = await this.calculateMonthForecast(
          userId,
          forecastDate,
          historicalData,
          recurringTransactions,
          futureTransactions
        );
        
        forecast.push(monthForecast);
      }
      
      return forecast;
    } catch (error) {
      console.error('Generate forecast error:', error);
      return [];
    }
  }

  async getHistoricalData(userId, months = 6) {
    try {
      const transactions = await RedisService.findAllUserTransactions(userId);
      const monthlyData = {};
      
      // Group transactions by month
      transactions.forEach(txn => {
        const txnDate = new Date(txn.date);
        const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = {
            income: 0,
            expenses: 0,
            transactions: 0
          };
        }
        
        if (txn.type === 'income') {
          monthlyData[monthKey].income += txn.amount_myr;
        } else {
          monthlyData[monthKey].expenses += txn.amount_myr;
        }
        monthlyData[monthKey].transactions++;
      });
      
      return monthlyData;
    } catch (error) {
      console.error('Get historical data error:', error);
      return {};
    }
  }

  async getFutureTransactions(userId) {
    try {
      const transactions = await RedisService.findAllUserTransactions(userId);
      const futureTransactions = transactions.filter(txn => {
        return new Date(txn.date) > new Date() && txn.is_future;
      });
      
      return futureTransactions;
    } catch (error) {
      console.error('Get future transactions error:', error);
      return [];
    }
  }

  async calculateMonthForecast(userId, targetDate, historicalData, recurringTransactions, futureTransactions) {
    try {
      const month = targetDate.getMonth();
      const year = targetDate.getFullYear();
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      
      // Calculate historical averages
      const historicalAverage = this.calculateHistoricalAverage(historicalData, month);
      
      // Calculate confirmed recurring for this month
      const recurringAmount = this.calculateRecurringForMonth(recurringTransactions, targetDate);
      
      // Calculate scheduled future transactions for this month
      const futureAmount = this.calculateFutureForMonth(futureTransactions, targetDate);
      
      // Calculate confidence based on data availability
      const confidence = this.calculateConfidence(historicalData, month, recurringTransactions.length);
      
      // Seasonal adjustments (basic implementation)
      const seasonalMultiplier = this.getSeasonalMultiplier(month);
      
      const projectedIncome = (historicalAverage.income * seasonalMultiplier) + 
                             recurringAmount.income + 
                             futureAmount.income;
      
      const projectedExpenses = (historicalAverage.expenses * seasonalMultiplier) + 
                               recurringAmount.expenses + 
                               futureAmount.expenses;
      
      return {
        month: monthKey,
        projected_income: Math.max(0, projectedIncome),
        projected_expenses: Math.max(0, projectedExpenses),
        net_flow: projectedIncome - projectedExpenses,
        confidence_level: confidence,
        breakdown: {
          historical_income: historicalAverage.income * seasonalMultiplier,
          recurring_income: recurringAmount.income,
          future_income: futureAmount.income,
          historical_expenses: historicalAverage.expenses * seasonalMultiplier,
          recurring_expenses: recurringAmount.expenses,
          future_expenses: futureAmount.expenses
        },
        seasonal_multiplier: seasonalMultiplier
      };
    } catch (error) {
      console.error('Calculate month forecast error:', error);
      return {
        month: `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`,
        projected_income: 0,
        projected_expenses: 0,
        net_flow: 0,
        confidence_level: 0.1,
        breakdown: {
          historical_income: 0,
          recurring_income: 0,
          future_income: 0,
          historical_expenses: 0,
          recurring_expenses: 0,
          future_expenses: 0
        },
        seasonal_multiplier: 1
      };
    }
  }

  calculateHistoricalAverage(historicalData, targetMonth) {
    const monthlyValues = Object.values(historicalData);
    
    if (monthlyValues.length === 0) {
      return { income: 0, expenses: 0 };
    }
    
    // Calculate simple average
    const totalIncome = monthlyValues.reduce((sum, month) => sum + month.income, 0);
    const totalExpenses = monthlyValues.reduce((sum, month) => sum + month.expenses, 0);
    
    return {
      income: totalIncome / monthlyValues.length,
      expenses: totalExpenses / monthlyValues.length
    };
  }

  calculateRecurringForMonth(recurringTransactions, targetDate) {
    let income = 0;
    let expenses = 0;
    
    recurringTransactions.forEach(recurring => {
      if (!recurring.is_active) return;
      
      // Calculate how many times this recurring transaction occurs in the target month
      const occurrences = this.calculateOccurrencesInMonth(recurring, targetDate);
      
      if (recurring.type === 'income') {
        income += recurring.amount_myr * occurrences;
      } else {
        expenses += recurring.amount_myr * occurrences;
      }
    });
    
    return { income, expenses };
  }

  calculateOccurrencesInMonth(recurring, targetDate) {
    const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
    
    let occurrences = 0;
    let currentDate = new Date(Math.max(new Date(recurring.next_due), startOfMonth));
    
    while (currentDate <= endOfMonth) {
      if (currentDate >= startOfMonth) {
        occurrences++;
      }
      
      // Calculate next occurrence
      switch (recurring.frequency) {
        case 'daily':
          currentDate.setDate(currentDate.getDate() + 1);
          break;
        case 'weekly':
          currentDate.setDate(currentDate.getDate() + 7);
          break;
        case 'monthly':
          currentDate.setMonth(currentDate.getMonth() + 1);
          break;
        case 'yearly':
          currentDate.setFullYear(currentDate.getFullYear() + 1);
          break;
        default:
          return occurrences; // Break infinite loop for unknown frequency
      }
      
      // Safety check to prevent infinite loop
      if (occurrences > 100) break;
    }
    
    return occurrences;
  }

  calculateFutureForMonth(futureTransactions, targetDate) {
    let income = 0;
    let expenses = 0;
    
    futureTransactions.forEach(txn => {
      const txnDate = new Date(txn.date);
      if (txnDate.getFullYear() === targetDate.getFullYear() && 
          txnDate.getMonth() === targetDate.getMonth()) {
        
        if (txn.type === 'income') {
          income += txn.amount_myr;
        } else {
          expenses += txn.amount_myr;
        }
      }
    });
    
    return { income, expenses };
  }

  calculateConfidence(historicalData, targetMonth, recurringCount) {
    const dataPoints = Object.keys(historicalData).length;
    
    // Base confidence on amount of historical data
    let confidence = Math.min(dataPoints / 6, 1) * 0.7; // Max 70% from historical data
    
    // Add confidence from recurring transactions
    confidence += Math.min(recurringCount / 5, 1) * 0.3; // Max 30% from recurring
    
    // Reduce confidence for future months
    confidence *= 0.95; // 5% reduction per month into future
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  getSeasonalMultiplier(month) {
    // Basic seasonal adjustments for Malaysian business context
    const seasonalFactors = {
      0: 0.9,   // January - post-holiday slowdown
      1: 1.0,   // February - normal
      2: 1.1,   // March - quarter end
      3: 1.0,   // April - normal
      4: 1.0,   // May - normal
      5: 1.1,   // June - quarter end
      6: 1.0,   // July - normal
      7: 1.0,   // August - normal
      8: 1.1,   // September - quarter end
      9: 1.0,   // October - normal
      10: 1.2,  // November - pre-holiday boost
      11: 1.3   // December - holiday season
    };
    
    return seasonalFactors[month] || 1.0;
  }

  async generateDetailedForecast(userId, months = 12) {
    try {
      const basicForecast = await this.generateForecast(userId, months);
      const scenarios = await this.generateScenarios(userId, months);
      const liquidityAnalysis = await this.analyzeLiquidityNeeds(userId, basicForecast);
      
      return {
        base_forecast: basicForecast,
        scenarios: scenarios,
        liquidity_analysis: liquidityAnalysis,
        recommendations: await this.generateRecommendations(userId, basicForecast, liquidityAnalysis)
      };
    } catch (error) {
      console.error('Generate detailed forecast error:', error);
      return null;
    }
  }

  async generateScenarios(userId, months = 6) {
    try {
      const baseForecast = await this.generateForecast(userId, months);
      
      const scenarios = {
        optimistic: { total_net: 0, monthly: [] },
        pessimistic: { total_net: 0, monthly: [] },
        realistic: { total_net: 0, monthly: [] }
      };
      
      baseForecast.forEach(month => {
        const baseNet = month.projected_income - month.projected_expenses;
        
        // Optimistic: +20% income, -10% expenses
        const optimisticIncome = month.projected_income * 1.2;
        const optimisticExpenses = month.projected_expenses * 0.9;
        const optimisticNet = optimisticIncome - optimisticExpenses;
        
        // Pessimistic: -20% income, +10% expenses
        const pessimisticIncome = month.projected_income * 0.8;
        const pessimisticExpenses = month.projected_expenses * 1.1;
        const pessimisticNet = pessimisticIncome - pessimisticExpenses;
        
        scenarios.optimistic.monthly.push({
          month: month.month,
          income: optimisticIncome,
          expenses: optimisticExpenses,
          net: optimisticNet
        });
        
        scenarios.pessimistic.monthly.push({
          month: month.month,
          income: pessimisticIncome,
          expenses: pessimisticExpenses,
          net: pessimisticNet
        });
        
        scenarios.realistic.monthly.push({
          month: month.month,
          income: month.projected_income,
          expenses: month.projected_expenses,
          net: baseNet
        });
        
        scenarios.optimistic.total_net += optimisticNet;
        scenarios.pessimistic.total_net += pessimisticNet;
        scenarios.realistic.total_net += baseNet;
      });
      
      return scenarios;
    } catch (error) {
      console.error('Generate scenarios error:', error);
      return null;
    }
  }

  async analyzeLiquidityNeeds(userId, forecast) {
    try {
      const liquidityBreakdown = await AssetService.getLiquidityBreakdown(userId);
      const currentLiquid = liquidityBreakdown.liquid.total;
      
      let cumulativeCash = currentLiquid;
      let minCashLevel = currentLiquid;
      let maxCashNeed = 0;
      let monthsWithNegativeFlow = 0;
      
      const monthlyAnalysis = [];
      
      forecast.forEach(month => {
        const netFlow = month.projected_income - month.projected_expenses;
        cumulativeCash += netFlow;
        
        if (netFlow < 0) {
          monthsWithNegativeFlow++;
          maxCashNeed = Math.max(maxCashNeed, Math.abs(netFlow));
        }
        
        minCashLevel = Math.min(minCashLevel, cumulativeCash);
        
        monthlyAnalysis.push({
          month: month.month,
          net_flow: netFlow,
          cumulative_cash: cumulativeCash,
          liquidity_status: cumulativeCash >= 0 ? 'sufficient' : 'deficit'
        });
      });
      
      return {
        current_liquid_assets: currentLiquid,
        minimum_cash_level: minCashLevel,
        maximum_monthly_need: maxCashNeed,
        months_with_negative_flow: monthsWithNegativeFlow,
        recommended_emergency_fund: maxCashNeed * 3, // 3x the largest monthly deficit
        liquidity_runway_months: currentLiquid > 0 ? 
          this.calculateLiquidityRunway(currentLiquid, forecast) : 0,
        monthly_analysis: monthlyAnalysis
      };
    } catch (error) {
      console.error('Analyze liquidity needs error:', error);
      return null;
    }
  }

  calculateLiquidityRunway(currentLiquid, forecast) {
    let remainingCash = currentLiquid;
    let months = 0;
    
    for (const month of forecast) {
      const netFlow = month.projected_income - month.projected_expenses;
      remainingCash += netFlow;
      
      if (remainingCash <= 0) {
        break;
      }
      
      months++;
    }
    
    return months;
  }

  async generateRecommendations(userId, forecast, liquidityAnalysis) {
    try {
      const recommendations = [];
      
      // Liquidity recommendations
      if (liquidityAnalysis.minimum_cash_level < 0) {
        recommendations.push({
          type: 'liquidity',
          priority: 'high',
          title: 'Cash Flow Deficit Warning',
          description: `Your forecast shows potential cash shortfalls. Consider building an emergency fund of RM${liquidityAnalysis.recommended_emergency_fund.toFixed(2)}.`
        });
      }
      
      if (liquidityAnalysis.liquidity_runway_months < 3) {
        recommendations.push({
          type: 'liquidity',
          priority: 'medium',
          title: 'Low Liquidity Runway',
          description: `Your liquid assets only cover ${liquidityAnalysis.liquidity_runway_months} months. Aim for 3-6 months of expenses.`
        });
      }
      
      // Revenue recommendations
      const avgMonthlyRevenue = forecast.reduce((sum, m) => sum + m.projected_income, 0) / forecast.length;
      const revenueGrowth = this.calculateGrowthTrend(forecast.map(m => m.projected_income));
      
      if (revenueGrowth < 0) {
        recommendations.push({
          type: 'revenue',
          priority: 'high',
          title: 'Declining Revenue Trend',
          description: 'Your revenue forecast shows a declining trend. Consider diversifying income sources or improving marketing efforts.'
        });
      }
      
      // Expense recommendations
      const avgMonthlyExpenses = forecast.reduce((sum, m) => sum + m.projected_expenses, 0) / forecast.length;
      const expenseGrowth = this.calculateGrowthTrend(forecast.map(m => m.projected_expenses));
      
      if (expenseGrowth > 0.05) { // More than 5% growth
        recommendations.push({
          type: 'expenses',
          priority: 'medium',
          title: 'Rising Expense Trend',
          description: 'Your expenses are growing faster than expected. Review and optimize recurring costs.'
        });
      }
      
      // Profitability recommendations
      const profitableMonths = forecast.filter(m => (m.projected_income - m.projected_expenses) > 0).length;
      const profitabilityRatio = profitableMonths / forecast.length;
      
      if (profitabilityRatio < 0.7) {
        recommendations.push({
          type: 'profitability',
          priority: 'high',
          title: 'Low Profitability',
          description: `Only ${Math.round(profitabilityRatio * 100)}% of forecasted months are profitable. Focus on increasing revenue or reducing costs.`
        });
      }
      
      return recommendations;
    } catch (error) {
      console.error('Generate recommendations error:', error);
      return [];
    }
  }

  calculateGrowthTrend(values) {
    if (values.length < 2) return 0;
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    
    return firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
  }

  async getCashflowSummary(userId) {
    try {
      const forecast = await this.generateForecast(userId, 6);
      const liquidityBreakdown = await AssetService.getLiquidityBreakdown(userId);
      const recurringStats = await RecurringService.getRecurringStats(userId);
      
      const totalProjectedIncome = forecast.reduce((sum, m) => sum + m.projected_income, 0);
      const totalProjectedExpenses = forecast.reduce((sum, m) => sum + m.projected_expenses, 0);
      const netProjectedFlow = totalProjectedIncome - totalProjectedExpenses;
      
      return {
        period: '6 months',
        total_projected_income: totalProjectedIncome,
        total_projected_expenses: totalProjectedExpenses,
        net_projected_flow: netProjectedFlow,
        current_liquid_assets: liquidityBreakdown.liquid.total,
        recurring_monthly_impact: recurringStats ? recurringStats.total_monthly_impact : 0,
        average_confidence: forecast.reduce((sum, m) => sum + m.confidence_level, 0) / forecast.length,
        risk_level: this.assessRiskLevel(netProjectedFlow, liquidityBreakdown.liquid.total)
      };
    } catch (error) {
      console.error('Get cashflow summary error:', error);
      return null;
    }
  }

  assessRiskLevel(netFlow, liquidAssets) {
    if (netFlow < 0 && liquidAssets < Math.abs(netFlow)) {
      return 'high';
    } else if (netFlow < 0 || liquidAssets < 10000) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  async exportForecastData(userId, format = 'json') {
    try {
      const detailedForecast = await this.generateDetailedForecast(userId, 12);
      
      if (format === 'csv') {
        let csv = 'Month,Projected Income,Projected Expenses,Net Flow,Confidence Level,Optimistic Net,Pessimistic Net\n';
        
        detailedForecast.base_forecast.forEach((month, index) => {
          const optimistic = detailedForecast.scenarios.optimistic.monthly[index];
          const pessimistic = detailedForecast.scenarios.pessimistic.monthly[index];
          
          csv += `${month.month},${month.projected_income.toFixed(2)},${month.projected_expenses.toFixed(2)},${month.net_flow.toFixed(2)},${(month.confidence_level * 100).toFixed(1)}%,${optimistic.net.toFixed(2)},${pessimistic.net.toFixed(2)}\n`;
        });
        
        return csv;
      }
      
      return JSON.stringify(detailedForecast, null, 2);
    } catch (error) {
      console.error('Export forecast data error:', error);
      return null;
    }
  }
}

module.exports = new CashflowService();