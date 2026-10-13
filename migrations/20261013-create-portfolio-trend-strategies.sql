-- Run once on PostgreSQL; commit explicitly in HeidiSQL.
BEGIN;
CREATE TABLE IF NOT EXISTS public.portfolio_trend_strategies (
  portfolio_id UUID PRIMARY KEY REFERENCES public.portafogli(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  strategy_key VARCHAR(80) NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolio_trend_strategies_settings_object CHECK (jsonb_typeof(settings) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_portfolio_trend_strategies_user ON public.portfolio_trend_strategies(user_id);
COMMIT;
