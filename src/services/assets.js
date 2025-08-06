const redis = require('../../config/redis');
const { v4: uuidv4 } = require('uuid');

class AssetService {
  async createAsset(userId, assetData) {
    try {
      const assetId = uuidv4();
      const asset = {
        id: assetId,
        user_id: userId.toString(),
        name: assetData.name,
        type: assetData.type,
        category: this.classifyLiquidity(assetData.type),
        current_value_myr: parseFloat(assetData.value),
        purchase_price_myr: parseFloat(assetData.purchase_price || assetData.value),
        purchase_date: assetData.purchase_date || new Date().toISOString(),
        liquidity_days: this.getLiquidityDays(assetData.type),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Store asset
      await redis.json.set(`asset:${assetId}`, '$', asset);
      await redis.lPush(`user:${userId}:assets`, assetId);

      // CREATE JOURNAL ENTRY FOR ASSET ADDITION
      if (LedgerService) {
        try {
          let assetAccountCode = '1000'; // Default to Cash
          let equityAccountCode = '3000'; // Owner's Equity
          
          // Determine correct asset account
          if (assetData.type === 'cash') assetAccountCode = '1000';
          else if (assetData.type === 'bank_savings') assetAccountCode = '1100';
          else if (assetData.type === 'crypto') assetAccountCode = '1800';
          else if (assetData.type === 'property') assetAccountCode = '1700';
          else if (assetData.type === 'stocks') assetAccountCode = '1800';
          
          await LedgerService.createJournalEntry(userId, {
            description: `Initial ${assetData.name} asset`,
            reference: `ASSET-${assetId.substring(0, 8)}`,
            lines: [
              {
                account_code: assetAccountCode,
                debit: parseFloat(assetData.value),
                credit: 0,
                description: `Add ${assetData.name}`
              },
              {
                account_code: equityAccountCode,
                debit: 0,
                credit: parseFloat(assetData.value),
                description: `Owner contribution - ${assetData.name}`
              }
            ]
          });
        } catch (journalError) {
          console.error('Asset journal entry error:', journalError);
        }
      }

      console.log(`✅ Created asset: ${assetId} for user ${userId}`);
      return asset;
    } catch (error) {
      console.error('Create asset error:', error);
      throw error;
    }
  }

  async getUserAssets(userId) {
    try {
      const assetIds = await redis.lRange(`user:${userId}:assets`, 0, -1);
      const assets = [];
      
      for (const assetId of assetIds) {
        try {
          const asset = await redis.json.get(`asset:${assetId}`);
          if (asset && asset.is_active) {
            assets.push(asset);
          } else if (!asset) {
            // Clean up invalid reference
            await redis.lRem(`user:${userId}:assets`, 1, assetId);
          }
        } catch (error) {
          console.error(`Error getting asset ${assetId}:`, error);
          // Clean up invalid reference
          await redis.lRem(`user:${userId}:assets`, 1, assetId);
        }
      }
      
      // Sort by value (highest first)
      assets.sort((a, b) => b.current_value_myr - a.current_value_myr);
      
      return assets;
    } catch (error) {
      console.error('Get user assets error:', error);
      return [];
    }
  }

  async getAsset(assetId) {
    try {
      const asset = await redis.json.get(`asset:${assetId}`);
      return asset;
    } catch (error) {
      console.error('Get asset error:', error);
      return null;
    }
  }

  async updateAssetValue(userId, assetId, newValue) {
    try {
      const asset = await this.getAsset(assetId);
      
      if (!asset || asset.user_id !== userId.toString()) {
        return { success: false, error: 'Asset not found or unauthorized' };
      }
      
      const oldValue = asset.current_value_myr;
      const timestamp = new Date().toISOString();
      
      // Update current value
      await redis.json.set(`asset:${assetId}`, '$.current_value_myr', parseFloat(newValue));
      await redis.json.set(`asset:${assetId}`, '$.updated_at', timestamp);
      
      // Add to price history
      const historyEntry = {
        date: timestamp,
        value: parseFloat(newValue)
      };
      await redis.json.arrAppend(`asset:${assetId}`, '$.price_history', historyEntry);
      
      // Keep only last 100 price history entries
      const historyLength = await redis.json.arrLen(`asset:${assetId}`, '$.price_history');
      if (historyLength > 100) {
        await redis.json.arrTrim(`asset:${assetId}`, '$.price_history', -100, -1);
      }
      
      // Add to update stream
      await redis.xAdd('assets_updated', '*', {
        user_id: userId.toString(),
        asset_id: assetId.toString(),
        old_value: oldValue.toString(),
        new_value: newValue.toString(),
        timestamp: Date.now().toString()
      });
      
      console.log(`✅ Updated asset ${assetId}: RM${oldValue} -> RM${newValue}`);
      return { success: true, oldValue, newValue };
    } catch (error) {
      console.error('Update asset value error:', error);
      return { success: false, error: 'Failed to update asset value' };
    }
  }

  async deleteAsset(userId, assetId) {
    try {
      const asset = await this.getAsset(assetId);
      
      if (!asset || asset.user_id !== userId.toString()) {
        return { success: false, error: 'Asset not found or unauthorized' };
      }
      
      // Mark as inactive instead of deleting (for audit trail)
      await redis.json.set(`asset:${assetId}`, '$.is_active', false);
      await redis.json.set(`asset:${assetId}`, '$.deleted_at', new Date().toISOString());
      
      // Remove from indexes
      await redis.sRem(`assets:${asset.category}`, assetId);
      await redis.sRem(`assets:type:${asset.type}`, assetId);
      
      // Add to deletion stream
      await redis.xAdd('assets_deleted', '*', {
        user_id: userId.toString(),
        asset_id: assetId.toString(),
        value: asset.current_value_myr.toString(),
        deleted_at: Date.now().toString()
      });
      
      console.log(`✅ Deleted asset: ${assetId} for user ${userId}`);
      return { success: true, asset };
    } catch (error) {
      console.error('Delete asset error:', error);
      return { success: false, error: 'Failed to delete asset' };
    }
  }

  async getLiquidityBreakdown(userId) {
    try {
      const assets = await this.getUserAssets(userId);
      
      const breakdown = {
        liquid: { total: 0, assets: [] },
        semi_liquid: { total: 0, assets: [] },
        illiquid: { total: 0, assets: [] },
        total_net_worth: 0,
        liquidity_ratio: 0
      };

      assets.forEach(asset => {
        breakdown[asset.category].total += asset.current_value_myr;
        breakdown[asset.category].assets.push(asset);
        breakdown.total_net_worth += asset.current_value_myr;
      });

      // Calculate liquidity ratio (liquid + semi-liquid / total)
      if (breakdown.total_net_worth > 0) {
        breakdown.liquidity_ratio = (breakdown.liquid.total + breakdown.semi_liquid.total) / breakdown.total_net_worth;
      }

      return breakdown;
    } catch (error) {
      console.error('Get liquidity breakdown error:', error);
      return {
        liquid: { total: 0, assets: [] },
        semi_liquid: { total: 0, assets: [] },
        illiquid: { total: 0, assets: [] },
        total_net_worth: 0,
        liquidity_ratio: 0
      };
    }
  }

  async getAssetPerformance(userId) {
    try {
      const assets = await this.getUserAssets(userId);
      
      const performance = {
        total_gain_loss: 0,
        total_gain_loss_percentage: 0,
        best_performer: null,
        worst_performer: null,
        by_category: {
          liquid: { gain_loss: 0, percentage: 0 },
          semi_liquid: { gain_loss: 0, percentage: 0 },
          illiquid: { gain_loss: 0, percentage: 0 }
        }
      };

      let totalPurchaseValue = 0;
      let totalCurrentValue = 0;
      let bestGain = -Infinity;
      let worstGain = Infinity;

      assets.forEach(asset => {
        const gainLoss = asset.current_value_myr - asset.purchase_price_myr;
        const gainLossPercentage = asset.purchase_price_myr > 0 ? 
          (gainLoss / asset.purchase_price_myr) * 100 : 0;

        // Track totals
        totalPurchaseValue += asset.purchase_price_myr;
        totalCurrentValue += asset.current_value_myr;

        // Track category performance
        performance.by_category[asset.category].gain_loss += gainLoss;

        // Track best/worst performers
        if (gainLossPercentage > bestGain) {
          bestGain = gainLossPercentage;
          performance.best_performer = {
            ...asset,
            gain_loss: gainLoss,
            gain_loss_percentage: gainLossPercentage
          };
        }

        if (gainLossPercentage < worstGain) {
          worstGain = gainLossPercentage;
          performance.worst_performer = {
            ...asset,
            gain_loss: gainLoss,
            gain_loss_percentage: gainLossPercentage
          };
        }
      });

      // Calculate total performance
      performance.total_gain_loss = totalCurrentValue - totalPurchaseValue;
      performance.total_gain_loss_percentage = totalPurchaseValue > 0 ? 
        (performance.total_gain_loss / totalPurchaseValue) * 100 : 0;

      // Calculate category percentages
      Object.keys(performance.by_category).forEach(category => {
        const categoryAssets = assets.filter(a => a.category === category);
        const categoryPurchaseValue = categoryAssets.reduce((sum, a) => sum + a.purchase_price_myr, 0);
        
        if (categoryPurchaseValue > 0) {
          performance.by_category[category].percentage = 
            (performance.by_category[category].gain_loss / categoryPurchaseValue) * 100;
        }
      });

      return performance;
    } catch (error) {
      console.error('Get asset performance error:', error);
      return null;
    }
  }

  classifyLiquidity(assetType) {
    const liquidityMap = {
      'cash': 'liquid',
      'bank_savings': 'liquid',
      'bank_current': 'liquid',
      'crypto': 'semi_liquid',
      'stocks': 'semi_liquid',
      'bonds': 'semi_liquid',
      'fixed_deposit': 'semi_liquid',
      'property': 'illiquid',
      'business_equity': 'illiquid',
      'collectibles': 'illiquid',
      'other': 'semi_liquid'
    };
    
    return liquidityMap[assetType] || 'semi_liquid';
  }

  getLiquidityDays(assetType) {
    const liquidityDays = {
      'cash': 0,
      'bank_savings': 1,
      'bank_current': 1,
      'crypto': 1,
      'stocks': 3,
      'bonds': 7,
      'fixed_deposit': 30,
      'property': 90,
      'business_equity': 180,
      'collectibles': 60,
      'other': 7
    };
    
    return liquidityDays[assetType] || 7;
  }

  async updateAssetPrices() {
    try {
      // This would typically fetch real-time prices for crypto, stocks, etc.
      // For now, we'll implement a basic price update simulation
      
      const cryptoAssets = await redis.sMembers('assets:type:crypto');
      let updatedCount = 0;
      
      for (const assetId of cryptoAssets) {
        try {
          const asset = await redis.json.get(`asset:${assetId}`);
          if (asset && asset.is_active && asset.name.toLowerCase().includes('bitcoin')) {
            // Simulate Bitcoin price update (in a real app, fetch from API)
            const currentPrice = asset.current_value_myr;
            const priceChange = (Math.random() - 0.5) * 0.1; // ±5% random change
            const newPrice = currentPrice * (1 + priceChange);
            
            await this.updateAssetValue(asset.user_id, assetId, newPrice);
            updatedCount++;
          }
        } catch (error) {
          console.error(`Error updating asset price ${assetId}:`, error);
        }
      }
      
      if (updatedCount > 0) {
        console.log(`✅ Updated prices for ${updatedCount} assets`);
      }
      
      return updatedCount;
    } catch (error) {
      console.error('Update asset prices error:', error);
      return 0;
    }
  }

  async getAssetAllocation(userId) {
    try {
      const assets = await this.getUserAssets(userId);
      const breakdown = await this.getLiquidityBreakdown(userId);
      
      const allocation = {
        by_liquidity: {
          liquid: {
            percentage: breakdown.total_net_worth > 0 ? 
              (breakdown.liquid.total / breakdown.total_net_worth) * 100 : 0,
            value: breakdown.liquid.total
          },
          semi_liquid: {
            percentage: breakdown.total_net_worth > 0 ? 
              (breakdown.semi_liquid.total / breakdown.total_net_worth) * 100 : 0,
            value: breakdown.semi_liquid.total
          },
          illiquid: {
            percentage: breakdown.total_net_worth > 0 ? 
              (breakdown.illiquid.total / breakdown.total_net_worth) * 100 : 0,
            value: breakdown.illiquid.total
          }
        },
        by_type: {},
        recommendations: []
      };

      // Calculate allocation by type
      const typeGroups = {};
      assets.forEach(asset => {
        if (!typeGroups[asset.type]) {
          typeGroups[asset.type] = 0;
        }
        typeGroups[asset.type] += asset.current_value_myr;
      });

      Object.keys(typeGroups).forEach(type => {
        allocation.by_type[type] = {
          percentage: breakdown.total_net_worth > 0 ? 
            (typeGroups[type] / breakdown.total_net_worth) * 100 : 0,
          value: typeGroups[type]
        };
      });

      // Generate recommendations
      if (allocation.by_liquidity.liquid.percentage < 20) {
        allocation.recommendations.push('Consider increasing liquid assets to at least 20% for emergency fund');
      }
      
      if (allocation.by_liquidity.illiquid.percentage > 60) {
        allocation.recommendations.push('High illiquid asset allocation - consider rebalancing for better liquidity');
      }
      
      if (allocation.by_type.crypto && allocation.by_type.crypto.percentage > 10) {
        allocation.recommendations.push('Crypto allocation above 10% - consider risk management');
      }

      return allocation;
    } catch (error) {
      console.error('Get asset allocation error:', error);
      return null;
    }
  }
}

module.exports = new AssetService();