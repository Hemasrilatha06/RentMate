-- Add public product photos to the 24 seeded demo listings.
-- This targets the exact demo owner IDs and titles from seed_items.sql, and
-- fills NULL image_url values and replaces only the four previously verified
-- broken demo URLs. Other existing photos are preserved, including photos on
-- user-created listings.
-- Run manually after seed_items.sql; this file does not change the schema.

with demo_images (owner_id, title, image_url) as (values
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'Canon EOS 200D DSLR Camera', 'https://commons.wikimedia.org/wiki/Special:FilePath/Canon_EOS_200D_-_01.jpg?width=1200'),
  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'Fujifilm Instax Mini 11', 'https://asset.fujifilm.com/www/uy/files/2020-02/3d8afa828b75acdabc73cc2651ab4e22/pic_instaxmini11_design_01.jpg'),
  ('6f33f7d1-d9d0-472e-9104-f4baea3874dc'::uuid, 'Sony Handycam HDR-CX405', 'https://dtz3um9jw7ngl.cloudfront.net/p/l/7630865K/7630865K.jpg'),
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'Nikon D3500 with 18-55mm Lens', 'https://cdn.mos.cms.futurecdn.net/wnfqmMWomJsuqeFbAK9bNi.jpg'),

  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'JBL Flip 6 Bluetooth Speaker', 'https://no.jbl.com/dw/image/v2/BFND_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw98ec93ec/3_JBL_FLIP6_FRONT_BLACK_29509_x2.png?sh=824&sw=824'),
  ('6f33f7d1-d9d0-472e-9104-f4baea3874dc'::uuid, 'Apple iPad 9th Generation', 'https://d2xamzlzrdbdbn.cloudfront.net/products/db906bca-1348-4d29-a04d-c49e21480db321161309.jpg'),
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'Sony WH-CH720N Wireless Headphones', 'https://conceptkart.com/cdn/shop/files/Concept-Kart-Sony-WH-CH720N-Wireless-Headphone-5-_1.jpg?v=1691477563'),
  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'TP-Link Wi-Fi 6 Router', 'https://static.tp-link.com/upload/image-line/Archer_AX56_US_1.0_overview_01_large_20260513075433g.jpg'),

  ('6f33f7d1-d9d0-472e-9104-f4baea3874dc'::uuid, 'Casio FX-991CW Scientific Calculator', 'https://media.johnlewiscontent.com/i/JohnLewis/112105155?%24background-off-white%24=&fmt=auto'),
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'Casio fx-82MS Scientific Calculator', 'https://img.freeup.app/fit-in/800x1000/filters%3Aupscale%28%29/f212aee3b7b7b6329faadb6d5ad01bc6.jpg'),
  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'Texas Instruments TI-30XS Multiview', 'https://www.eaieducation.com/media/catalog/product/E/A/EAI-70337_L.jpg?bg-color=255%2C255%2C255&canvas=265%3A265&fit=bounds&height=265&quality=80&width=265'),

  ('6f33f7d1-d9d0-472e-9104-f4baea3874dc'::uuid, 'Epson EB-E01 Classroom Projector', 'https://avshack.in/cdn/shop/products/1_11657f07-4b0c-4167-a79f-8e865d01cfb3.jpg?v=1626551621&width=1920'),
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'BenQ MS550 Meeting Room Projector', 'https://image.benq.com/is/image/benqco/MS550_Regular_Front_SVGA-1'),
  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'Portronics Beem 430 Portable Projector', 'https://static.toiimg.com/thumb/msid-107367495%2Cwidth-1280%2Cheight-720%2Cresizemode-4/107367495.jpg'),

  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'Decathlon Riverside 120 Hybrid Cycle', 'https://contents.mediadecathlon.com/p2191808/k%247feadd0def536338dacfe264519978c9/hibridni-bicikl-riverside-120-sivi.jpg'),
  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'Hero Sprint Pro Mountain Bicycle', 'https://i.sstatic.net/wQEpo.jpg'),
  ('6f33f7d1-d9d0-472e-9104-f4baea3874dc'::uuid, 'Btwin Tilt 120 Folding Bicycle', 'https://contents.mediadecathlon.com/p1249805/k%24472b58b9db34e7ef6da64b754333801f/folding-bike-tilt-120-20-red-btwin-btwin-8544671.jpg?f=3000x0&format=auto'),
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'Firefox Road Runner 27.5T', 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1200&q=85'),

  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'The Thursday Murder Club', 'https://images.pangobooks.com/images/d3bde4e3-c7ff-41f6-9df2-f0791c636386?format=auto&quality=85&width=1080'),
  ('6f33f7d1-d9d0-472e-9104-f4baea3874dc'::uuid, 'Atomic Habits by James Clear', 'https://purpledoor-cambridge.ca/cdn/shop/files/20230724_133054.jpg?v=1690230085'),
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'The Complete Sherlock Holmes', 'https://books.google.com/books/content?id=tfT5b0WiSVkC&printsec=frontcover&img=1&zoom=1&source=gbs_api'),

  ('76f24dcc-b9ce-45f4-82c0-eab3969e682b'::uuid, 'Decathlon 2-Person Camping Tent', 'https://contents.mediadecathlon.com/p2579569/k%24732793bd9c58f6f2349cceae12309c00/sator-za-kampiranje-mh100-fresh-and-black-za-dvije-osobe.jpg'),
  ('6f33f7d1-d9d0-472e-9104-f4baea3874dc'::uuid, 'Prestige Electric Pressure Cooker', 'https://shop.ttkprestige.com/media/catalog/product/0/4/0455-20173-IMG1.jpg'),
  ('9caed17a-e075-4cf0-894d-6c3c34b01028'::uuid, 'Wildcraft 50L Hiking Backpack', 'https://wildcraft.com/media/catalog/product/2/_/2_2746.jpg?width=960')
), updated_items as (
  update public.items as item
  set image_url = demo.image_url
  from demo_images as demo
  where item.owner_id = demo.owner_id
    and item.title = demo.title
    and (
      item.image_url is null
      or item.image_url in (
        'https://www.sony.com/is/image/gwtprod/2213402f41fd3e2ccf1d0c34f49ad89a?fmt=png-alpha&hei=900&wid=900',
        'https://www.nikon.co.in/media/wysiwyg/20220507/D3500.png',
        'https://cdn.shopware.store/N/R/R/AlrFq/media/28/4a/02/1772707448/e00116fd8aea4c83b7e16a629cb670ec.jpeg?ts=1772707448',
        'https://electroworld.abenson.com/media/catalog/product/1/8/189112_2023_3.jpg'
      )
    )
  returning item.id
)
select count(*) as updated_rows from updated_items;
