// src/services/assets.js
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
        category: this.classifyAssetCategory(assetData.type),
        current_value_myr: parseFloat(assetData.value),
        purchase_price_myr: parseFloat(assetData.purchase_price || assetData.value),
        purchase_date: assetData.purchase_date || new Date().toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Store asset
      await redis.json.set(`asset:${assetId}`, '$', asset);
      await redis.lPush(`user:${userId}:assets`, assetId);

      // CREATE JOURNAL ENTRY FOR ASSET ADDITION
      try {
        const LedgerService = require('./ledger');
        let assetAccountCode = '1000'; // Default to Cash
        let equityAccountCode = '3000'; // Owner's Equity
        
        // Determine correct asset account
        if (assetData.type === 'cash') assetAccountCode = '1000';
        else if (assetData.type === 'bank_savings') assetAccountCode = '1100';
        else if (assetData.type === 'crypto') assetAccountCode = '1800';
        else if (assetData.type === 'property') assetAccountCode = '1700';
        else if (assetData.type === 'stocks') assetAccountCode = '1800';
        else if (assetData.type === 'equipment') assetAccountCode = '1500';
        
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
            await redis.lRem(`user:${userId}:assets`, 1, assetId);
          }
        } catch (error) {
          console.error(`Error getting asset ${assetId}:`, error);
          await redis.lRem(`user:${userId}:assets`, 1, assetId);
        }
      }
      
      assets.sort((a, b) => b.current_value_myr - a.current_value_myr);
      return assets;
    } catch (error) {
      console.error('Get user assets error:', error);
      return [];
    }
  }

  async deleteAsset(userId, assetId) {
    try {
      const asset = await this.getAsset(assetId);
      
      if (!asset || asset.user_id !== userId.toString()) {
        return { success: false, error: 'Asset not found or unauthorized' };
      }
      
      // CREATE REVERSE JOURNAL ENTRY WHEN DELETING ASSET
      try {
        const LedgerService = require('./ledger');
        let assetAccountCode = '1000';
        let equityAccountCode = '3000';
        
        if (asset.type === 'cash') assetAccountCode = '1000';
        else if (asset.type === 'bank_savings') assetAccountCode = '1100';
        else if (asset.type === 'crypto') assetAccountCode = '1800';
        else if (asset.type === 'property') assetAccountCode = '1700';
        else if (asset.type === 'stocks') assetAccountCode = '1800';
        else if (asset.type === 'equipment') assetAccountCode = '1500';
        
        await LedgerService.createJournalEntry(userId, {
          description: `Remove ${asset.name} asset`,
          reference: `ASSET-DEL-${assetId.substring(0, 8)}`,
          lines: [
            {
              account_code: equityAccountCode,
              debit: asset.current_value_myr,
              credit: 0,
              description: `Remove ${asset.name}`
            },
            {
              account_code: assetAccountCode,
              debit: 0,
              credit: asset.current_value_myr,
              description: `Asset removal - ${asset.name}`
            }
          ]
        });
      } catch (journalError) {
        console.error('Asset deletion journal entry error:', journalError);
      }
      
      // Mark as inactive
      await redis.json.set(`asset:${assetId}`, '$.is_active', false);
      await redis.json.set(`asset:${assetId}`, '$.deleted_at', new Date().toISOString());
      
      console.log(`✅ Deleted asset: ${assetId} for user ${userId}`);
      return { success: true, asset };
    } catch (error) {
      console.error('Delete asset error:', error);
      return { success: false, error: 'Failed to delete asset' };
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

  classifyAssetCategory(assetType) {
    const categoryMap = {
      'cash': 'current',
      'bank_savings': 'current',
      'bank_current': 'current',
      'crypto': 'investment',
      'stocks': 'investment',
      'bonds': 'investment',
      'fixed_deposit': 'current',
      'property': 'fixed',
      'equipment': 'fixed',
      'business_equity': 'investment',
      'other': 'current'
    };
    
    return categoryMap[assetType] || 'current';
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
        // Map categories to liquidity for backward compatibility
        let liquidityCategory = 'semi_liquid';
        if (asset.category === 'current') liquidityCategory = 'liquid';
        else if (asset.category === 'fixed') liquidityCategory = 'illiquid';
        else if (asset.category === 'investment') liquidityCategory = 'semi_liquid';

        breakdown[liquidityCategory].total += asset.current_value_myr;
        breakdown[liquidityCategory].assets.push(asset);
        breakdown.total_net_worth += asset.current_value_myr;
      });

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
}

module.exports = new AssetService();