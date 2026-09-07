const axios = require('axios');

(async () => {
  try {
    const apiKey = 'WNETYETWIPZRW8EK';
    const ticker = 'MVOL';
    
    const response = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol: ticker,
        apikey: apiKey
      },
      timeout: 10000
    });
    
    console.log('Alpha Vantage Response for MVOL:');
    console.log(JSON.stringify(response.data, null, 2));
    
    console.log('\n\nFields available:');
    if (response.data['Global Quote']) {
      Object.keys(response.data['Global Quote']).forEach(key => {
        console.log(`  "${key}": ${response.data['Global Quote'][key]}`);
      });
      
      console.log('\n\nPrice fields:');
      console.log(`  "05. price" (current): ${response.data['Global Quote']['05. price']}`);
      console.log(`  "08. previous close": ${response.data['Global Quote']['08. previous close']}`);
      console.log(`  "09. change": ${response.data['Global Quote']['09. change']}`);
      console.log(`  "10. change percent": ${response.data['Global Quote']['10. change percent']}`);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
