const axios = require('axios');

(async () => {
  try {
    const apiKey = 'WNETYETWIPZRW8EK';
    const tickers = ['MVOL', 'IE00B8FHGS14', 'MSEU', 'MESG', 'EUNL'];
    
    for (const ticker of tickers) {
      console.log(`\n=== Testing ticker: ${ticker} ===`);
      
      const response = await axios.get('https://www.alphavantage.co/query', {
        params: {
          function: 'GLOBAL_QUOTE',
          symbol: ticker,
          apikey: apiKey
        },
        timeout: 5000
      });
      
      const quote = response.data['Global Quote'];
      if (quote && quote['05. price']) {
        console.log(`✓ Price found: €${quote['05. price']}`);
        console.log(`  Previous close: €${quote['08. previous close']}`);
        console.log(`  Change: ${quote['09. change']} (${quote['10. change percent']})`);
      } else {
        console.log('✗ No price data');
        if (response.data['Note']) {
          console.log(`  Note: ${response.data['Note']}`);
        }
        if (response.data['Error Message']) {
          console.log(`  Error: ${response.data['Error Message']}`);
        }
      }
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
