-- Set the verified TP-Link Archer AX56 product image on its seeded demo row.
-- This targets only the exact demo owner ID and title. It fills a missing URL
-- or re-applies the URL already used by the demo image mapping; any other
-- existing photo is preserved. Run manually in the Supabase SQL Editor.

update public.items
set image_url = 'https://static.tp-link.com/upload/image-line/Archer_AX56_US_1.0_overview_01_large_20260513075433g.jpg'
where owner_id = '76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid
  and title = 'TP-Link Wi-Fi 6 Router'
  and (
    image_url is null
    or image_url = 'https://static.tp-link.com/upload/image-line/Archer_AX56_US_1.0_overview_01_large_20260513075433g.jpg'
  );
