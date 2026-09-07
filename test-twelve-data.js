const axios = require('axios');

async function testTwelveData() {
  const apiKey = '5a1f6dea81b840b5bb1d8cf20730195e';
  const symbol = 'SPY';
  
  try {
    console.log(`Testing Twelve Data API with symbol: ${symbol}\n`);
    
    const response = await axios.get('https://api.twelvedata.com/quote', {
      params: {
        symbol: symbol,
        apikey: apiKey
      },
      timeout: 5000
    });
    
    console.log('Response status:', response.status);
    console.log('Full response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.price) {
      console.log(`\n✓ Price found: ${response.data.price}`);
    } else {
      console.log(`\n✗ No price field in response`);
    }
  } catch (error) {
    console.error('Error:', error.response?.status, error.response?.statusText);
    console.error('Error data:', error.response?.data);
    console.error('Error message:', error.message);
  }
  
  process.exit(0);
}

testTwelveData();
