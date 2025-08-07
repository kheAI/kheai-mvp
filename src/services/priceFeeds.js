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
      // Try multiple APIs for better reliability
      const apis = [
        {
          url: 'https://api.coingecko.com/api/v3/simple/price',
          params: { ids: 'bitcoin', vs_currencies: 'myr' },
          transform: (data) => data.bitcoin.myr
        },
        {
          url: 'https://api.coinbase.com/v2/exchange-rates',
          params: { currency: 'BTC' },
          transform: (data) => parseFloat(data.data.rates.MYR)
        }
      ];

      let btcMyr = null;

      for (const api of apis) {
        try {
          const response = await axios.get(api.url, {
            params: api.params,
            timeout: 10000,
            headers: {
              'User-Agent': 'kheAI-Bot/1.0',
              'Accept': 'application/json'
            }
          });

          btcMyr = api.transform(response.data);
          if (btcMyr && btcMyr > 0) {
            console.log(`💰 BTC Price from ${api.url.split('/')[2]}: RM${btcMyr.toLocaleString()}`);
            break;
          }
        } catch (error) {
          console.log(`⚠️ API ${api.url.split('/')[2]} failed: ${error.message}`);
          continue;
        }
      }

      if (!btcMyr) {
        // Fallback price if all APIs fail
        btcMyr = 180000;
        console.log('⚠️ All price APIs failed, using fallback price: RM180,000');
      }
      
      // Store in Redis TimeSeries
      const timestamp = Date.now();
      
      try {
        await redis.ts.add('btc_myr_price', timestamp, btcMyr);
      } catch (error) {
        if (error.message.includes('TSDB: the key does not exist')) {
          await redis.ts.create('btc_myr_price');
          await redis.ts.add('btc_myr_price', timestamp, btcMyr);
        } else {
          console.log('⚠️ TimeSeries not available, using regular storage');
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
      const prices = await redis.hGetAll('latest_prices');
      return {
        btc_myr: parseFloat(prices.btc_myr || 180000),
        updated_at: prices.updated_at || new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting current prices:', error);
      return { 
        btc_myr: 180000, 
        updated_at: new Date().toISOString() 
      };
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