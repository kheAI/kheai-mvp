const axios = require('axios');
const redis = require('../../config/redis');

class PriceFeedsService {
  constructor() {
    this.isRunning = false;
  }

  async startPriceMonitoring() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🪙 Starting Bitcoin price monitoring...');
    
    // Update prices every 5 minutes
    setInterval(async () => {
      await this.updatePrices();
    }, 5 * 60 * 1000);
    
    // Initial update
    await this.updatePrices();
  }

  async updatePrices() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'bitcoin',
          vs_currencies: 'myr'
        },
        timeout: 10000
      });

      const btcMyr = response.data.bitcoin.myr;
      
      // Store in Redis TimeSeries
      const timestamp = Date.now();
      await redis.ts.add('btc_myr_price', timestamp, btcMyr);
      
      // Store latest price for quick access
      await redis.hSet('latest_prices', {
        btc_myr: btcMyr.toString(),
        updated_at: new Date().toISOString()
      });
      
      console.log(`💰 BTC Price updated: RM${btcMyr.toLocaleString()}`);
      
    } catch (error) {
      console.error('❌ Price update failed:', error.message);
    }
  }

  async getCurrentPrices() {
    try {
      return await redis.hGetAll('latest_prices');
    } catch (error) {
      console.error('Error getting current prices:', error);
      return { btc_myr: '0', updated_at: new Date().toISOString() };
    }
  }

  async getPriceHistory(hours = 24) {
    try {
      const fromTime = Date.now() - (hours * 60 * 60 * 1000);
      return await redis.ts.range('btc_myr_price', fromTime, '+');
    } catch (error) {
      console.error('Error getting price history:', error);
      return [];
    }
  }
}

module.exports = new PriceFeedsService();