-- ============================================================
-- 1stOne F1 — Task 3B: server-side serviceability
-- Applied to live DB 2026-05-18.
--
-- Moves the point-in-polygon serviceability decision off the device.
-- Before: serviceability.ts ray-cast zones/hubs on the client.
-- After:  these functions are the single source — the client only
--         calls resolve_address_serviceability() and stores the result.
--
-- All additive (CREATE OR REPLACE) — safe on a populated DB, no
-- existing object is dropped or altered.
-- ============================================================

-- ── Ray-casting point-in-polygon over a JSONB [{lat,lng}] ring ──
-- Mirrors the previous client implementation exactly. < 3 vertices,
-- null, or non-array input → false.
CREATE OR REPLACE FUNCTION point_in_polygon(
  p_lat double precision,
  p_lng double precision,
  p_poly jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n int;
  i int;
  j int;
  inside boolean := false;
  lat_i double precision; lng_i double precision;
  lat_j double precision; lng_j double precision;
BEGIN
  IF p_poly IS NULL OR jsonb_typeof(p_poly) <> 'array' THEN
    RETURN false;
  END IF;
  n := jsonb_array_length(p_poly);
  IF n < 3 THEN
    RETURN false;
  END IF;

  j := n - 1;
  FOR i IN 0 .. n - 1 LOOP
    lat_i := (p_poly -> i ->> 'lat')::double precision;
    lng_i := (p_poly -> i ->> 'lng')::double precision;
    lat_j := (p_poly -> j ->> 'lat')::double precision;
    lng_j := (p_poly -> j ->> 'lng')::double precision;
    IF ((lng_i > p_lng) <> (lng_j > p_lng))
       AND (p_lat < (lat_j - lat_i) * (p_lng - lng_i) / (lng_j - lng_i) + lat_i) THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;

  RETURN inside;
END;
$$;

-- ── Resolve an address's zone / routing hub / serviceability ──
-- Single source of the serviceability rule:
--   * zone_id   = first active zone whose polygon contains the point
--   * hub_id    = first active hub whose polygon contains the point
--                 (the delivery routing hub)
--   * serviceable = inside a zone, OR inside an extends_coverage hub
--   * result    = 'unknown' when nothing is configured yet (no zones
--                 and no extending hubs) so setup never blocks orders;
--                 else 'serviceable' / 'not_serviceable'
CREATE OR REPLACE FUNCTION resolve_address_serviceability(
  p_lat double precision,
  p_lng double precision
)
RETURNS TABLE (
  result         text,
  is_serviceable boolean,
  zone_id        int,
  zone_name      text,
  hub_id         int,
  hub_name       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_zone_id    int;
  v_zone_name  text;
  v_hub_id     int;
  v_hub_name   text;
  v_ext_hub_id int;
  v_config_count int;
BEGIN
  SELECT z.id, z.zone_name INTO v_zone_id, v_zone_name
  FROM delivery_zones z
  WHERE z.is_active
    AND jsonb_typeof(z.polygon_geojson) = 'array'
    AND jsonb_array_length(z.polygon_geojson) >= 3
    AND point_in_polygon(p_lat, p_lng, z.polygon_geojson)
  ORDER BY z.id
  LIMIT 1;

  SELECT h.id, h.hub_name INTO v_hub_id, v_hub_name
  FROM delivery_hubs h
  WHERE h.is_active
    AND jsonb_typeof(h.polygon_geojson) = 'array'
    AND jsonb_array_length(h.polygon_geojson) >= 3
    AND point_in_polygon(p_lat, p_lng, h.polygon_geojson)
  ORDER BY h.id
  LIMIT 1;

  SELECT h.id INTO v_ext_hub_id
  FROM delivery_hubs h
  WHERE h.is_active AND h.extends_coverage
    AND jsonb_typeof(h.polygon_geojson) = 'array'
    AND jsonb_array_length(h.polygon_geojson) >= 3
    AND point_in_polygon(p_lat, p_lng, h.polygon_geojson)
  ORDER BY h.id
  LIMIT 1;

  -- Is any polygon configured at all? (active zones + active extending hubs)
  SELECT
    (SELECT count(*) FROM delivery_zones z
       WHERE z.is_active AND jsonb_typeof(z.polygon_geojson) = 'array'
         AND jsonb_array_length(z.polygon_geojson) >= 3)
  + (SELECT count(*) FROM delivery_hubs h
       WHERE h.is_active AND h.extends_coverage AND jsonb_typeof(h.polygon_geojson) = 'array'
         AND jsonb_array_length(h.polygon_geojson) >= 3)
  INTO v_config_count;

  zone_id        := v_zone_id;
  zone_name      := v_zone_name;
  hub_id         := v_hub_id;
  hub_name       := v_hub_name;
  is_serviceable := (v_zone_id IS NOT NULL) OR (v_ext_hub_id IS NOT NULL);

  IF is_serviceable THEN
    result := 'serviceable';
  ELSIF v_config_count > 0 THEN
    result := 'not_serviceable';
  ELSE
    result := 'unknown';
  END IF;

  RETURN NEXT;
END;
$$;

-- ── Bulk-assign every matching address to a hub (admin tool) ──
-- Replaces the client-side ray-cast in useAssignHubAddresses. Candidate
-- filter mirrors the retired get_addresses_for_hub_assignment. Returns
-- the number of addresses assigned.
CREATE OR REPLACE FUNCTION assign_addresses_to_hub(p_hub_id int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_poly jsonb;
  v_count int;
BEGIN
  SELECT polygon_geojson INTO v_poly FROM delivery_hubs WHERE id = p_hub_id;
  IF v_poly IS NULL OR jsonb_typeof(v_poly) <> 'array' OR jsonb_array_length(v_poly) < 3 THEN
    RETURN 0;
  END IF;

  WITH matched AS (
    UPDATE customer_addresses ca
    SET hub_id = p_hub_id
    WHERE (ca.is_serviceable = true OR ca.hub_id = p_hub_id OR ca.hub_id IS NULL)
      AND ca.latitude IS NOT NULL
      AND ca.longitude IS NOT NULL
      AND point_in_polygon(ca.latitude::double precision, ca.longitude::double precision, v_poly)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM matched;

  RETURN v_count;
END;
$$;
