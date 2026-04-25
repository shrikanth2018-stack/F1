-- 1stOne F1 — Per-item rating capture
--
-- Blueprint Sec 5.2: after Delivered, customer rates individual items AND the
-- overall experience. Overall goes into app_feedback (existing). Per-item
-- rows live here.
--
-- 1..5 star rating per order_item. NULL comments allowed.

CREATE TABLE IF NOT EXISTS order_item_ratings (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT  NOT NULL REFERENCES orders(id)      ON DELETE CASCADE,
  order_item_id BIGINT  NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  user_id       UUID    NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comments      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, order_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS order_item_ratings_order_idx ON order_item_ratings(order_id);

-- RLS: customers can insert + read their own; admins use service role.
ALTER TABLE order_item_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own rows insert" ON order_item_ratings;
CREATE POLICY "own rows insert"
  ON order_item_ratings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own rows select" ON order_item_ratings;
CREATE POLICY "own rows select"
  ON order_item_ratings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
