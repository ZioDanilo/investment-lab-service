require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { connectDB, sequelize } = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const portfolioRoutes = require('./routes/portfolio');
const etfRoutes = require('./routes/etf');
const kpiRoutes = require('./routes/kpi');
const rebalanceRoutes = require('./routes/rebalance');
const quotationRoutes = require('./routes/quotation');
const marketUniverseRoutes = require('./routes/marketUniverse');
const realPortfolioRoutes = require('./routes/realPortfolio');
const trendFollowingRoutes = require('./routes/trendFollowing');
const authRoutes = require('./routes/auth');
const factorEngineRoutes = require('./routes/factorEngine');
const giocatoriRoutes = require('./routes/giocatori');

const yahooFinanceRoutes = require('./routes/yahooFinance');

const app = express();

// La connessione al database viene completata prima di accettare richieste.

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
  'https://investment-lab-x.pages.dev',
  'https://razeretf.com',
  'https://www.razeretf.com'
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
app.use('/api/yahoo-finance', yahooFinanceRoutes);
app.use('/api/giocatori', giocatoriRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/etf', etfRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/rebalance', rebalanceRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/market-universe', marketUniverseRoutes);
app.use('/api/real-portfolios', realPortfolioRoutes);
app.use('/api/trend-following', trendFollowingRoutes);
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
async function ensureTrendFollowingSchema() {
  // Idempotent, additive schema bootstrap: no global sequelize.sync() or migrations.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS public.portfolio_trend_strategies (
      portfolio_id UUID PRIMARY KEY REFERENCES public.portafogli(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      strategy_key VARCHAR(80) NOT NULL,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT portfolio_trend_strategies_settings_object CHECK (jsonb_typeof(settings) = 'object')
    )
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_portfolio_trend_strategies_user
    ON public.portfolio_trend_strategies(user_id)
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS public.portfolio_trend_etf_selections (
      portfolio_id UUID NOT NULL REFERENCES public.portafogli(id) ON DELETE CASCADE,
      strategy_key VARCHAR(80) NOT NULL,
      slot_index SMALLINT NOT NULL CHECK (slot_index BETWEEN 0 AND 2),
      isin VARCHAR(12) NOT NULL REFERENCES public.anagrafica_etf(isin),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (portfolio_id, strategy_key, slot_index),
      UNIQUE (portfolio_id, strategy_key, isin)
    )
  `);
  // Import existing SMA200 selections once, without replacing newer slot records.
  await sequelize.query(`
    INSERT INTO public.portfolio_trend_etf_selections (portfolio_id, strategy_key, slot_index, isin)
    SELECT pts.portfolio_id, 'sma-200', slots.ordinality::smallint - 1, slots.isin
    FROM public.portfolio_trend_strategies pts
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(pts.settings->'etfIsins') = 'array' THEN pts.settings->'etfIsins' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS slots(isin, ordinality)
    JOIN public.anagrafica_etf e ON e.isin = slots.isin
    WHERE pts.strategy_key = 'sma-200' AND slots.ordinality <= 3 AND slots.isin <> ''
    ON CONFLICT DO NOTHING
  `);
  console.log('[Trend Following] Schema verificato.');
}

async function start() {
  const db = await connectDB();
  if (!db) throw new Error('Connessione al database non disponibile');
  await ensureTrendFollowingSchema();
  app.listen(PORT, () => {
    console.log(`Investment Lab Service running on port ${PORT}`);
  });
}
start().catch(error => {
  console.error('Avvio interrotto:', error);
  process.exitCode = 1;
});
