# RentMate Project Context

## Idea
Users list items they own for rent (cameras, projectors, bicycles, books, and more). Other users search, open an item, choose dates, and book it. A booking must be blocked when its dates overlap an existing booking. Renters and owners coordinate pickup, handover, and return confirmation.

Booking status lifecycle: `pending_payment` -> `confirmed` -> `picked_up` -> `return_requested` -> `returned`; a pending payment or confirmed booking may also be `cancelled`. New bookings begin as `pending_payment` and become confirmed only after the payment provider verifies payment.

## Tech
React + Vite, React Router, and Supabase for authentication, database, storage, and Edge Functions. Razorpay secrets stay in the Supabase Edge Function environment.

## Planned pages
1. Register / Login
2. Add Item
3. Browse and search
4. Item Details
5. Booking with date-clash check
6. My Bookings (cancel, request return confirmation, and review returned rentals)
7. My Listings (see bookings, mark handovers, and confirm requested returns)
8. Booking Details (pickup and return times, meeting spot, directions)
9. Messages (private owner-renter conversations)

## Planned tables
- profiles
- items
- bookings
- notifications
- conversations
- messages

## Rule
Read this file before every task.

