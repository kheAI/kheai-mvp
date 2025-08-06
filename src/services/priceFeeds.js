const axios = require('axios');
const redis = require('../../config/redis');

let isRunning = false;

class PriceFeedsService {
  static async startPriceMonitoring() {
    if (isRunning) return;
    
    isRunning = true;
    console.log('Starting Bitcoin price monitoring...');
    
    // Update prices every 5 minutes
    setInterval(async () => {
      await PriceFeedsService.updatePrices();
    }, 5 * 60 * 1000);
    
    // Initial update
    await PriceFeedsService.updatePrices();
  }

  static async updatePrices() {
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
      
      // Create TimeSeries if it doesn't exist
      try {
        await redis.ts.add('btc_myr_price', timestamp, btcMyr);
      } catch (error) {
        if (error.message.includes('TSDB: the key does not exist')) {
          await redis.ts.create('btc_myr_price');
          await redis.ts.add('btc_myr_price', timestamp, btcMyr);
        } else {
          throw error;
        }
      }
      
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

  static async getCurrentPrices() {
    try {
      return await redis.hGetAll('latest_prices');
    } catch (error) {
      console.error('Error getting current prices:', error);
      return { btc_myr: '0', updated_at: new Date().toISOString() };
    }
  }

  static async getPriceHistory(hours = 24) {
    try {
      const fromTime = Date.now() - (hours * 60 * 60 * 1000);
      return await redis.ts.range('btc_myr_price', fromTime, '+');
    } catch (error) {
      console.error('Error getting price history:', error);
      return [];
    }
  }
}

module.exports = PriceFeedsService;