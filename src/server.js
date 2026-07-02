require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const portfolioRoutes = require('./routes/portfolio');
const etfRoutes = require('./routes/etf');
const kpiRoutes = require('./routes/kpi');
const rebalanceRoutes = require('./routes/rebalance');

const app = express();

// Connect to Database
connectDB();

// Middleware
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'investment-lab-service'
  });
});

// API Routes
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/etf', etfRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/rebalance', rebalanceRoutes);

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
app.listen(PORT, () => {
  console.log(`Investment Lab Service running on port ${PORT}`);
});
