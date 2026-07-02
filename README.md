# Investment Lab Service

Backend API service for Investment Lab X - Portfolio Simulator

## Features

- RESTful API endpoints for portfolio management
- ETF data management
- KPI calculations
- Rebalance suggestions and execution
- MongoDB integration
- CORS support
- Error handling middleware

## Setup

### Prerequisites
- Node.js 18+
- MongoDB

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Update the environment variables:
   - `MONGODB_URI`: MongoDB connection string
   - `PORT`: Server port (default: 3000)
   - `FRONTEND_URL`: Frontend application URL

### Running

Development:
```bash
npm run dev
```

Production:
```bash
npm start
```

## API Endpoints

### Portfolio
- `GET /api/portfolio` - Get all portfolios
- `GET /api/portfolio/:id` - Get portfolio by ID
- `POST /api/portfolio` - Create new portfolio
- `PUT /api/portfolio/:id` - Update portfolio
- `DELETE /api/portfolio/:id` - Archive portfolio

### ETF
- `GET /api/etf` - Get all ETFs
- `GET /api/etf/:id` - Get ETF by ID
- `POST /api/etf` - Create new ETF
- `PUT /api/etf/:id` - Update ETF

### KPI
- `POST /api/kpi/calculate` - Calculate KPIs
- `GET /api/kpi/metrics/:portfolioId` - Get KPI metrics

### Rebalance
- `POST /api/rebalance/suggest` - Suggest rebalancing
- `POST /api/rebalance/execute` - Execute rebalancing

### Health
- `GET /api/health` - Service health check

## Project Structure

```
src/
├── config/          # Configuration files (database)
├── controllers/     # Route handlers
├── middleware/      # Express middleware
├── models/          # MongoDB schemas
├── routes/          # API routes
├── utils/           # Utility functions
└── server.js        # Entry point
```

## Environment Variables

See `.env.example` for all available configuration options.

## Development

### Running Tests
```bash
npm test
```

### Linting
```bash
npm run lint
```

## License

MIT
