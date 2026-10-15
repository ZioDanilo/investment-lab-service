CREATE TABLE IF NOT EXISTS public.portfolio_trend_etf_selections (
  portfolio_id UUID NOT NULL REFERENCES public.portafogli(id) ON DELETE CASCADE,
  strategy_key VARCHAR(80) NOT NULL,
  slot_index SMALLINT NOT NULL CHECK (slot_index BETWEEN 0 AND 2),
  isin VARCHAR(12) NOT NULL REFERENCES public.anagrafica_etf(isin),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, strategy_key, slot_index),
  UNIQUE (portfolio_id, strategy_key, isin)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_trend_etf_selections_isin ON public.portfolio_trend_etf_selections(isin);
