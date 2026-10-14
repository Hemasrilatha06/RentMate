-- Demo listings for RentMate. Get three UUIDs from Supabase Dashboard >
-- Authentication > Users, then paste them into the declarations below.
-- Use three distinct existing user IDs. The insert checks them before writing.

do $$
declare
  owner_1 uuid := '9caed17a-e075-4cf0-894d-6c3c34b01028';
  owner_2 uuid := '76f24dcc-b9ce-45f4-82c0-eab3969e682b';
  owner_3 uuid := '6f33f7d1-d9d0-472e-9104-f4baea3874dc'; -- paste a third existing auth.users UUID here
  inserted_count integer;
begin
  if owner_1 is null or owner_2 is null or owner_3 is null then
    raise exception 'Set owner_1, owner_2, and owner_3 to existing UUIDs from Supabase Authentication > Users before running this seed.';
  end if;

  if owner_1 = owner_2 or owner_1 = owner_3 or owner_2 = owner_3 then
    raise exception 'Use three distinct owner UUIDs so the demo items are spread across three users.';
  end if;

  if not exists (select 1 from auth.users where id = owner_1)
     or not exists (select 1 from auth.users where id = owner_2)
     or not exists (select 1 from auth.users where id = owner_3) then
    raise exception 'At least one owner UUID is not present in auth.users. Copy existing IDs from Supabase Authentication > Users.';
  end if;

  with demo_items (
    owner_id, title, description, category, price_per_day, location,
    available_from, available_to, is_active, image_url
  ) as (values
    (owner_1, 'Canon EOS 200D DSLR Camera', 'A lightweight DSLR with a sharp 24MP sensor, ideal for portraits and weekend trips. Includes a standard zoom lens, battery, charger, and a padded carry case.', 'Cameras', 550, 'Indiranagar, Bengaluru', current_date, current_date + 90, true, null),
    (owner_2, 'Fujifilm Instax Mini 11', 'Capture instant prints at parties, picnics, and celebrations with this easy-to-use camera. It comes with a wrist strap and a fresh pack of film.', 'Cameras', 180, 'Koramangala, Bengaluru', current_date, current_date + 90, true, null),
    (owner_3, 'Sony Handycam HDR-CX405', 'A compact full-HD camcorder with steady image stabilisation for family events and travel videos. Includes a battery, charger, and a 32GB memory card.', 'Cameras', 400, 'Koregaon Park, Pune', current_date, current_date + 90, true, null),
    (owner_1, 'Nikon D3500 with 18-55mm Lens', 'This beginner-friendly DSLR is great for learning photography and taking crisp everyday photos. The kit includes the original lens, battery, charger, and camera strap.', 'Cameras', 500, 'Bandra West, Mumbai', current_date, current_date + 90, true, null),

    (owner_2, 'JBL Flip 6 Bluetooth Speaker', 'A portable speaker with clear sound and enough volume for a small gathering or a day outdoors. It is water-resistant and comes with its charging cable.', 'Electronics', 120, 'HSR Layout, Bengaluru', current_date, current_date + 90, true, null),
    (owner_3, 'Apple iPad 9th Generation', 'A responsive tablet for reading, video calls, note-taking, and streaming while travelling. Includes a protective case, charging adapter, and cable.', 'Electronics', 600, 'Powai, Mumbai', current_date, current_date + 90, true, null),
    (owner_1, 'Sony WH-CH720N Wireless Headphones', 'Comfortable noise-cancelling headphones for focused work, commuting, or long flights. They connect over Bluetooth and include a USB charging cable.', 'Electronics', 250, 'Kothrud, Pune', current_date, current_date + 90, true, null),
    (owner_2, 'TP-Link Wi-Fi 6 Router', 'A dual-band router that can improve wireless coverage for a temporary home office or event. Setup is straightforward and the power adapter is included.', 'Electronics', 150, 'Whitefield, Bengaluru', current_date, current_date + 90, true, null),

    (owner_3, 'Casio FX-991CW Scientific Calculator', 'A reliable scientific calculator for engineering, mathematics, and exam preparation. It supports a wide range of functions and includes its protective hard case.', 'Calculators', 45, 'Aundh, Pune', current_date, current_date + 90, true, null),
    (owner_1, 'Casio fx-82MS Scientific Calculator', 'A simple, dependable calculator for school coursework and everyday calculations. The buttons are clearly labelled and a protective slide case is included.', 'Calculators', 30, 'Jayanagar, Bengaluru', current_date, current_date + 90, true, null),
    (owner_2, 'Texas Instruments TI-30XS Multiview', 'This scientific calculator displays multiple lines so you can review expressions and results together. It is useful for classroom practice and comes with a cover.', 'Calculators', 50, 'Andheri West, Mumbai', current_date, current_date + 90, true, null),

    (owner_3, 'Epson EB-E01 Classroom Projector', 'A bright, easy-to-set-up projector for presentations, movie nights, or small workshops. Includes the remote, power cable, and a carry bag.', 'Projectors', 600, 'Viman Nagar, Pune', current_date, current_date + 90, true, null),
    (owner_1, 'BenQ MS550 Meeting Room Projector', 'This dependable projector produces a clear picture for slides and video in a home or meeting room. HDMI and VGA inputs make it simple to connect to a laptop.', 'Projectors', 550, 'Marathahalli, Bengaluru', current_date, current_date + 90, true, null),
    (owner_2, 'Portronics Beem 430 Portable Projector', 'A compact projector for casual film nights and sharing photos on a larger wall. It includes its remote and power adapter, and is easy to carry between rooms.', 'Projectors', 350, 'Lower Parel, Mumbai', current_date, current_date + 90, true, null),

    (owner_1, 'Decathlon Riverside 120 Hybrid Cycle', 'A comfortable hybrid bicycle for neighbourhood rides, errands, and exploring nearby parks. It has a practical upright position and includes a basic lock.', 'Bicycles', 300, 'HSR Layout, Bengaluru', current_date, current_date + 90, true, null),
    (owner_2, 'Hero Sprint Pro Mountain Bicycle', 'A sturdy geared bicycle suited to city roads and light trails around the outskirts. The brakes and tyres are checked regularly, and a helmet is available on request.', 'Bicycles', 280, 'Baner, Pune', current_date, current_date + 90, true, null),
    (owner_3, 'Btwin Tilt 120 Folding Bicycle', 'This folding bicycle is handy for short commutes and compact storage in an apartment or office. It is tuned for city use and comes with a small front light.', 'Bicycles', 250, 'Powai, Mumbai', current_date, current_date + 90, true, null),
    (owner_1, 'Firefox Road Runner 27.5T', 'A versatile geared cycle for fitness rides and weekend outings on paved routes. The saddle height is adjustable and a bottle cage is fitted.', 'Bicycles', 350, 'Jubilee Hills, Hyderabad', current_date, current_date + 90, true, null),

    (owner_2, 'The Thursday Murder Club', 'Richard Osman’s cosy mystery follows four retirement-village friends solving a local cold case. This paperback is an easy companion for a weekend or a trip.', 'Books', 40, 'Indiranagar, Bengaluru', current_date, current_date + 90, true, null),
    (owner_3, 'Atomic Habits by James Clear', 'A practical guide to building small routines and making lasting behaviour changes. The book is in good condition with a clean cover and readable pages.', 'Books', 35, 'Koregaon Park, Pune', current_date, current_date + 90, true, null),
    (owner_1, 'The Complete Sherlock Holmes', 'A single-volume collection of Arthur Conan Doyle’s Sherlock Holmes stories and novels. It is a substantial edition for anyone who enjoys classic detective fiction.', 'Books', 60, 'Bandra West, Mumbai', current_date, current_date + 90, true, null),

    (owner_2, 'Decathlon 2-Person Camping Tent', 'A quick-pitch tent for a relaxed overnight stay or a weekend outdoors. It packs into its carry bag and includes the poles, pegs, and rain cover.', 'Other', 220, 'Whitefield, Bengaluru', current_date, current_date + 90, true, null),
    (owner_3, 'Prestige Electric Pressure Cooker', 'Prepare rice, lentils, and one-pot meals with this electric pressure cooker. The removable pot and measuring cup are included, and the controls are simple to use.', 'Other', 180, 'Aundh, Pune', current_date, current_date + 90, true, null),
    (owner_1, 'Wildcraft 50L Hiking Backpack', 'A roomy hiking backpack with padded straps and several compartments for organising a multi-day trip. The adjustable waist belt and rain cover are included.', 'Other', 150, 'Andheri West, Mumbai', current_date, current_date + 90, true, null)
  )
  insert into public.items (
    owner_id, title, description, category, price_per_day, location,
    available_from, available_to, is_active, image_url
  )
  select d.owner_id, d.title, d.description, d.category, d.price_per_day, d.location,
         d.available_from, d.available_to, d.is_active, d.image_url
  from demo_items as d
  where not exists (
    select 1 from public.items as existing
    where existing.owner_id = d.owner_id and existing.title = d.title
  );

  get diagnostics inserted_count = row_count;
  raise notice 'Inserted % demo items; existing items with the same owner and title were skipped.', inserted_count;
end;
$$;
