/**
 * Sample WhatsApp Chat Export for Demo/Testing
 * Format: Android style
 */

// This is exported as a module for use in demo mode
export const SAMPLE_CHAT = `12/01/25, 9:15 AM - John Smith: Hey everyone! Just checking in 👋
12/01/25, 10:32 AM - Sarah Johnson: 🏠 AVAILABLE FOR RENT 🏠

Beautiful 2 bedroom apartment in Downtown Manhattan, available from February 1st!

💰 Rent: $3,200/month
🛏️ 2 bedrooms, 1 bathroom
📍 Located in the Financial District

✅ Amenities:
- Fully furnished
- WiFi included
- Laundry in-unit
- Gym access
- Elevator building

Perfect for professionals! Long-term lease preferred (12 months).
DM me for more details or to schedule a viewing!
12/01/25, 11:00 AM - Mike Davis: That's a great price for Manhattan!
12/01/25, 11:45 AM - Emily Chen: 🔑 ROOM FOR RENT - Upper West Side

Single room available in a shared 3-bedroom apartment
📅 Available immediately
💵 $1,800/month all utilities included

The apartment has:
- Air conditioning
- Dishwasher
- Natural light
- Security building
- Near subway (B/C train)

Short-term ok (3 months minimum)
Cats welcome 🐱
Contact: Emily Chen
12/01/25, 2:30 PM - David Wilson: Anyone know a good moving company?
12/01/25, 3:15 PM - Lisa Park: Subletting my studio in Brooklyn Heights!

I'll be traveling for work from Feb 15th to May 15th (3 months)
💰 $1,950/month (all-in, utilities included)
🏠 Studio apartment, 450 sq ft
📍 Near Brooklyn Bridge
✅ Fully furnished, AC, gym in building, rooftop terrace
🐕 Sorry no pets

DM me if interested, this will go fast!
12/01/25, 5:00 PM - James Brown: FOR RENT - Beautiful Condo
📍 Midtown East, New York

$4,500/month | 3 bedroom | 2 bath

Features:
- Concierge service
- Pool
- Parking included
- Balcony with city views
- Hardwood floors
- Pet friendly (dogs ok!)

Available from March 1st. 12-month lease required.
Contact James for showings.
12/02/25, 8:00 AM - Sarah Johnson: Just reposting for visibility!

🏠 AVAILABLE FOR RENT 🏠

Beautiful 2 bedroom apartment in Downtown Manhattan, available from February 1st!

💰 Rent: $3,200/month
🛏️ 2 bedrooms, 1 bathroom
📍 Located in the Financial District

✅ Amenities:
- Fully furnished
- WiFi included
- Laundry in-unit
- Gym access
- Elevator building

Perfect for professionals! Long-term lease preferred (12 months).
DM me for more details!
12/02/25, 9:30 AM - Amanda White: Nice 1 bedroom in Hoboken NJ

Just across the river from Manhattan!
Rent: $2,100/month
Move in: February 1st

- Unfurnished
- Laundry in building
- Parking available ($150/mo extra)
- Bike storage
- Pet friendly

12-month lease. Contact Amanda.
12/02/25, 11:00 AM - Robert Taylor: Hey all, looking for something to rent 2 beds around $2000
12/02/25, 12:15 PM - Jennifer Martinez: MUST SEE - Luxury townhouse for rent!

📍 Park Slope, Brooklyn

💰 $5,500/month
🏡 3 bedrooms, 2.5 bathrooms
📅 Available from January 15th

Highlights:
- Private backyard garden
- Fully furnished
- Central air conditioning  
- Washer/dryer in unit
- Dishwasher
- Storage unit included
- Pet friendly (cats & dogs!)

Long-term lease preferred. Shown by appointment only.
12/02/25, 2:00 PM - Kevin Lee: Studio apartment in Astoria Queens

🏠 For Rent - Great deal!
$1,650/month (negotiable for right tenant)
Available now

Semi-furnished (bed, couch, dining table included)
WiFi ready
No parking
Pets ok (cats only)

Short term or long term both fine!
Text Kevin for details.
12/03/25, 10:00 AM - Carol Brown: 2 BHK apartment available in Chelsea

This won't last long!
Monthly rent: $3,800
Available from February 15

Features:
- Gym in building
- Concierge
- Elevator
- Hardwood floors
- Natural light (south-facing)
- Laundry on every floor

Unfurnished. 12-month lease. No pets.
`;

/**
 * Convert the sample chat string into the format expected by the app
 * so we can demo without an actual upload
 */
export function getSampleChatAsFile() {
  const blob = new Blob([SAMPLE_CHAT], { type: 'text/plain' });
  return new File([blob], 'WhatsApp Chat - Rental Group.txt', { type: 'text/plain' });
}
