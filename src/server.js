require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { connectDB } = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const portfolioRoutes = require('./routes/portfolio');
const etfRoutes = require('./routes/etf');
const kpiRoutes = require('./routes/kpi');
const rebalanceRoutes = require('./routes/rebalance');
const correlationsRoutes = require('./routes/correlations');
const quotationRoutes = require('./routes/quotation');
const monteCarloRoutes = require('./routes/montecarlo');
const marketUniverseRoutes = require('./routes/marketUniverse');
const realPortfolioRoutes = require('./routes/realPortfolio');
const authRoutes = require('./routes/auth');
const factorEngineRoutes = require('./routes/factorEngine');
const giocatoriRoutes = require('./routes/giocatori');

const app = express();

// La connessione e la migrazione sono completate prima di accettare richieste.

// Setup Sequelize associations
const { initializeAssociations } = require('./config/database');
initializeAssociations();

// Middleware
app.use(helmet());
app.use(morgan('dev'));

// CORS Configuration - allow Angular dev server and localhost variations
const allowedOrigins = new Set([
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://investment-lab-x.pages.dev'
]);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || /^https:\/\/numeri(?:\.[a-z0-9-]+)?\.workers\.dev$/i.test(origin) || /^https:\/\/(?:[a-z0-9-]+\.)?numeri\.pages\.dev$/i.test(origin)) {
      callback(null, true);
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Username']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'investment-lab-service',
    database: 'PostgreSQL'
  });
});

// API Routes
app.use('/api/giocatori', giocatoriRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/etf', etfRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/rebalance', rebalanceRoutes);
app.use('/api/correlations', correlationsRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/monte-carlo', monteCarloRoutes);
app.use('/api/market-universe', marketUniverseRoutes);
app.use('/api/real-portfolios', realPortfolioRoutes);
app.use('/api/factor-engine', factorEngineRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path
  });
});

// Error Handler Middleware
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 3000;
async function start() {
  const db = await connectDB();
  if (!db) throw new Error('Connessione al database non disponibile');
  const { migrateGiocatori } = require('../scripts/migrate-giocatori');
  await migrateGiocatori();
  app.listen(PORT, () => {
    console.log(`Investment Lab Service running on port ${PORT}`);
  });
}
start().catch(error => {
  console.error('Avvio interrotto: migrazione giocatori non riuscita', error);
  process.exitCode = 1;
});
