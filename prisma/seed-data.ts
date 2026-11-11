/**
 * Static seed content: properties, photos, investor names.
 *
 * PHOTOS: real photography from Unsplash (unsplash.com/license), hot-linked from
 * images.unsplash.com. No AI-generated images. `credit` is left empty where the photographer
 * could not be verified from the build environment; see "Photo credits" in the README.
 */

const img = (id: string) => `https://images.unsplash.com/photo-${id}`;

export type SeedPhoto = { url: string; alt: string; credit: string; creditUrl: string };
const photo = (id: string, alt: string, credit = "", creditUrl = ""): SeedPhoto => ({ url: img(id), alt, credit, creditUrl });

export type SeedProperty = {
  slug: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  propertyType: "SINGLE_FAMILY" | "DUPLEX" | "TOWNHOME" | "SMALL_MULTIFAMILY";
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  yearBuilt: number;
  description: string;
  neighborhood: string;
  schoolsNote: string;
  transitNote: string;
  risks: string[];
  purchasePrice: number; // dollars
  closingCosts: number;
  reserveFund: number;
  sharePrice: number; // dollars
  monthlyRent: number;
  annualTaxes: number;
  annualInsurance: number;
  monthlyHoa: number;
  avgMaintenance: number;
  plannedExitOffsetYears: number; // relative to the seed year
  propertyManagerName: string;
  seedStatus: "COMING_SOON" | "FUNDING" | "TRADING" | "EXIT_VOTE";
  fundedMonthsAgo?: number;
  fundedPct?: number; // for FUNDING
  deadlineInDays?: number;
  appraisalPath?: number[]; // multipliers of purchase price, oldest first, roughly quarterly
  photos: SeedPhoto[];
};

export const PROPERTIES: SeedProperty[] = [
  {
    slug: "kenwood-bungalow-columbus",
    name: "Kenwood Bungalow",
    street: "1482 Kenwood Avenue",
    city: "Columbus",
    state: "OH",
    zip: "43206",
    propertyType: "SINGLE_FAMILY",
    bedrooms: 3,
    bathrooms: 1.5,
    squareFeet: 1420,
    yearBuilt: 1924,
    description:
      "A 1924 bungalow with a full-width front porch, original oak floors and a kitchen that was redone in 2019. It sits on a quiet block of similar houses, most of them owner-occupied. The current tenants, a couple who work at the nearby hospital, signed a two-year lease.",
    neighborhood:
      "Southern Orchards, just east of German Village. Parsons Avenue, three blocks away, has a grocery store, two coffee shops and a hardware store. Nationwide Children's Hospital is a ten-minute walk and is the area's largest employer.",
    schoolsNote: "Placeholder: Columbus City Schools; nearest elementary 0.4 mi.",
    transitNote: "Placeholder: COTA bus lines on Parsons Ave; downtown in about 12 minutes.",
    risks: [
      "The house is 100 years old. The roof was replaced in 2016, but the plumbing is partly original galvanized pipe and may need replacing within the holding period.",
      "One tenant. If they leave, the home earns nothing until it is re-let. It sat empty for most of one month last year.",
      "Columbus prices rose quickly from 2020 to 2023. There is no assurance that continues.",
    ],
    purchasePrice: 238_000,
    closingCosts: 7_200,
    reserveFund: 6_800,
    sharePrice: 10,
    monthlyRent: 2_150,
    annualTaxes: 4_080,
    annualInsurance: 1_416,
    monthlyHoa: 0,
    avgMaintenance: 140,
    plannedExitOffsetYears: 3,
    propertyManagerName: "Buckeye Residential Management",
    seedStatus: "TRADING",
    fundedMonthsAgo: 15,
    appraisalPath: [1.0, 1.013, 1.006, 1.034, 1.055, 1.071],
    photos: [
      photo("1572120360610-d971b9d7767c", "White bungalow with a covered front porch and autumn trees"),
      photo("1560185007-cde436f6a4d0", "Dining and living room with hardwood floors and bay window"),
      photo("1484154218962-a197022b5858", "White kitchen with stainless appliances and an island"),
      photo("1560185893-a55cbc8c57e8", "Bedroom with hardwood floor and two windows"),
    ],
  },
  {
    slug: "holmes-street-duplex-kansas-city",
    name: "Holmes Street Duplex",
    street: "5127 Holmes Street",
    city: "Kansas City",
    state: "MO",
    zip: "64110",
    propertyType: "DUPLEX",
    bedrooms: 4,
    bathrooms: 2,
    squareFeet: 2080,
    yearBuilt: 1948,
    description:
      "A side-by-side brick duplex. Each half has two bedrooms, one bath, its own garage bay and its own furnace and water heater. Two leases mean the building rarely earns nothing: when one side turns over, the other still pays.",
    neighborhood:
      "South of the Country Club Plaza, between the University of Missouri–Kansas City and Rockhurst University. Renters here are mostly graduate students, medical residents and university staff.",
    schoolsNote: "Placeholder: Kansas City Public Schools; two universities within one mile.",
    transitNote: "Placeholder: Troost MAX bus rapid transit two blocks east.",
    risks: [
      "University-area rentals turn over more often than family homes. Expect a vacancy on one side most summers.",
      "Built in 1948 with a shared sewer lateral. A repair to it would affect both units at once.",
      "Missouri reassesses property every two years; taxes rose 11% at the last reassessment.",
    ],
    purchasePrice: 312_000,
    closingCosts: 9_400,
    reserveFund: 10_600,
    sharePrice: 20,
    monthlyRent: 3_100,
    annualTaxes: 4_920,
    annualInsurance: 2_040,
    monthlyHoa: 0,
    avgMaintenance: 210,
    plannedExitOffsetYears: 4,
    propertyManagerName: "Plaza Midtown Property Co.",
    seedStatus: "TRADING",
    fundedMonthsAgo: 14,
    appraisalPath: [1.0, 0.992, 1.01, 1.022, 1.018, 1.041],
    photos: [
      photo("1605276374104-dee2a0ed3cd6", "Brick house with two garage doors and a paved driveway"),
      photo("1493809842364-78817add7ffb", "Bright living room with wood floor and a row of windows"),
      photo("1556911220-bff31c812dba", "Kitchen counter with white cabinets and gas range"),
      photo("1505693416388-ac5ce068fe85", "Bedroom with upholstered headboard and bench"),
    ],
  },
  {
    slug: "seminole-heights-cottage-tampa",
    name: "Seminole Heights Cottage",
    street: "912 East Hanna Avenue",
    city: "Tampa",
    state: "FL",
    zip: "33604",
    propertyType: "SINGLE_FAMILY",
    bedrooms: 3,
    bathrooms: 2,
    squareFeet: 1560,
    yearBuilt: 1956,
    description:
      "A three-bedroom cottage with a metal roof installed in 2021 and impact-rated windows. It was offered with a short planned holding period, and that period has now ended: holders are voting on whether to sell.",
    neighborhood:
      "Seminole Heights, north of downtown Tampa. A neighborhood of 1920s–1950s houses that has drawn restaurants and breweries along Florida Avenue over the past decade.",
    schoolsNote: "Placeholder: Hillsborough County Public Schools; magnet high school 0.8 mi.",
    transitNote: "Placeholder: HART bus on Nebraska Ave; I-275 access within one mile.",
    risks: [
      "Florida insurance premiums have risen sharply. This home's premium went up 23% at its last renewal and may rise again.",
      "The home is in a region exposed to hurricanes. It is not in a mandatory flood zone, but storm damage and deductibles are a real risk.",
      "Tampa prices have softened since their 2022 peak. A sale now may bring less than the latest appraisal suggests.",
    ],
    purchasePrice: 418_000,
    closingCosts: 11_500,
    reserveFund: 10_500,
    sharePrice: 25,
    monthlyRent: 3_050,
    annualTaxes: 6_240,
    annualInsurance: 4_380,
    monthlyHoa: 0,
    avgMaintenance: 180,
    plannedExitOffsetYears: 0,
    propertyManagerName: "Bayshore Home Rentals",
    seedStatus: "EXIT_VOTE",
    fundedMonthsAgo: 20,
    appraisalPath: [1.0, 1.021, 1.038, 1.029, 1.012, 1.024, 1.031],
    photos: [
      photo("1583608205776-bfd35f0d9f83", "Grey shingled house with a white porch and palm trees"),
      photo("1560448204-e02f11c3d0e2", "Living room with large windows and beige sofas"),
      photo("1560448075-bb485b067938", "Bathroom with pedestal sink and tiled floor"),
      photo("1502672260266-1c1ef2d93688", "Sitting room with bookshelves and house plants"),
    ],
  },
  {
    slug: "oakwood-brick-ranch-raleigh",
    name: "Oakwood Brick Ranch",
    street: "2209 Poole Road",
    city: "Raleigh",
    state: "NC",
    zip: "27610",
    propertyType: "SINGLE_FAMILY",
    bedrooms: 3,
    bathrooms: 2,
    squareFeet: 1680,
    yearBuilt: 1962,
    description:
      "A single-story brick house on a third of an acre. Brick, a simple roofline and one level keep upkeep predictable. It is under contract; the purchase closes once every share is sold.",
    neighborhood:
      "East Raleigh, ten minutes from downtown and from WakeMed's main campus. A neighborhood of mid-century ranches that has seen steady renovation as buyers are priced out of areas closer in.",
    schoolsNote: "Placeholder: Wake County Public Schools; elementary 0.6 mi.",
    transitNote: "Placeholder: GoRaleigh route 18 on Poole Rd; I-440 within 1.5 miles.",
    risks: [
      "This offering is not yet funded. If every share is not sold by the deadline, the purchase is cancelled and all money is returned.",
      "There is no tenant yet. The projected rent is the manager's estimate from comparable homes nearby, not a signed lease.",
      "The HVAC system is 14 years old and is likely to need replacement during the holding period. The reserve is sized with that in mind, but costs could exceed it.",
    ],
    purchasePrice: 365_000,
    closingCosts: 9_800,
    reserveFund: 9_200,
    sharePrice: 16,
    monthlyRent: 2_750,
    annualTaxes: 3_960,
    annualInsurance: 1_680,
    monthlyHoa: 0,
    avgMaintenance: 160,
    plannedExitOffsetYears: 6,
    propertyManagerName: "Triangle Home Management",
    seedStatus: "FUNDING",
    fundedPct: 64,
    deadlineInDays: 24,
    photos: [
      photo("1598228723793-52759bba239c", "Brick house with dormer windows on a landscaped lawn"),
      photo("1554995207-c18c203602cb", "Open living room with leather sofa and kitchen beyond"),
      photo("1565182999561-18d7dc61c393", "Living room with white sofas and a staircase"),
    ],
  },
  {
    slug: "meridian-kessler-fourplex-indianapolis",
    name: "Meridian-Kessler Fourplex",
    street: "4410 North College Avenue",
    city: "Indianapolis",
    state: "IN",
    zip: "46205",
    propertyType: "SMALL_MULTIFAMILY",
    bedrooms: 8,
    bathrooms: 4,
    squareFeet: 3900,
    yearBuilt: 1926,
    description:
      "A 1926 house converted long ago into four two-bedroom apartments, two up and two down, behind a shared front porch. Four leases spread the risk of a vacancy across four tenants. Three units are currently let; the fourth is being repainted.",
    neighborhood:
      "Meridian-Kessler, a north-side neighborhood of early-twentieth-century houses. College Avenue has restaurants, a food co-op and the Red Line rapid bus.",
    schoolsNote: "Placeholder: Indianapolis Public Schools; Butler University 1.2 mi.",
    transitNote: "Placeholder: IndyGo Red Line station one block south.",
    risks: [
      "This offering is not yet funded. If every share is not sold by the deadline, the purchase is cancelled and all money is returned.",
      "A 100-year-old building with four kitchens and four bathrooms has more to maintain than a single home. Maintenance will be a larger share of rent.",
      "The property is in a local historic district. Exterior changes need approval, which can add cost and time to repairs.",
    ],
    purchasePrice: 624_000,
    closingCosts: 15_000,
    reserveFund: 21_000,
    sharePrice: 50,
    monthlyRent: 6_400,
    annualTaxes: 9_360,
    annualInsurance: 3_840,
    monthlyHoa: 0,
    avgMaintenance: 520,
    plannedExitOffsetYears: 7,
    propertyManagerName: "Circle City Residential",
    seedStatus: "FUNDING",
    fundedPct: 31,
    deadlineInDays: 52,
    photos: [
      photo("1570129477492-45c003edd2be", "Large grey-and-white house with a wraparound porch"),
      photo("1600210492486-724fe5c67fb0", "Sunlit living room with framed prints and leather sofa"),
      photo("1522708323590-d24dbb6b0267", "Apartment living area with red armchair and dining table"),
    ],
  },
  {
    slug: "crestwood-craftsman-birmingham",
    name: "Crestwood Craftsman",
    street: "5536 Ninth Court South",
    city: "Birmingham",
    state: "AL",
    zip: "35212",
    propertyType: "SINGLE_FAMILY",
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 1120,
    yearBuilt: 1930,
    description:
      "A two-bedroom Craftsman with a deep front porch and square columns. It is the smallest and least expensive home on the platform. The offering opens after the inspection report and appraisal are published.",
    neighborhood:
      "Crestwood South, east of downtown Birmingham. Small pre-war houses on hilly, tree-lined streets, close to the restaurants on Crestwood Boulevard and to UAB's medical district.",
    schoolsNote: "Placeholder: Birmingham City Schools; elementary 0.5 mi.",
    transitNote: "Placeholder: MAX Transit route on Crestwood Blvd; I-20 within one mile.",
    risks: [
      "Not yet open for investment. The numbers shown are preliminary and may change before the offering opens.",
      "A lower-priced home means fixed costs such as a roof or HVAC replacement are a larger share of its value.",
      "Two-bedroom homes appeal to fewer renters than three-bedroom homes, which can lengthen vacancies.",
    ],
    purchasePrice: 184_000,
    closingCosts: 5_600,
    reserveFund: 5_400,
    sharePrice: 13,
    monthlyRent: 1_650,
    annualTaxes: 1_440,
    annualInsurance: 1_560,
    monthlyHoa: 0,
    avgMaintenance: 110,
    plannedExitOffsetYears: 6,
    propertyManagerName: "Red Mountain Property Services",
    seedStatus: "COMING_SOON",
    photos: [
      photo("1599427303058-f04cbcf4756f", "Grey Craftsman house with white porch columns and railing"),
      photo("1586023492125-27b2c045efd7", "Corner of a room with a yellow armchair and floor lamp"),
    ],
  },
];

export const INVESTOR_NAMES = [
  "Amara Okafor", "Daniel Whitlock", "Priya Raman", "Marcus Bell", "Elena Sokolova", "Tomás Herrera", "Grace Lindqvist",
  "Owen Fitzgerald", "Mei-Ling Zhao", "Rashad Coleman", "Hannah Brandt", "Luis Carvalho", "Naomi Feldman", "Jerome Baptiste",
  "Sofia Marchetti", "Andre Whitfield", "Kavita Desai", "Ben Oyelaran", "Claire Dubois", "Isaac Thornton",
];
export const INVESTOR_STATES = ["OH", "MO", "FL", "NC", "IN", "AL", "TX", "IL", "GA", "PA", "CO", "WA", "MN", "AZ", "VA", "TN", "MI", "OR", "NJ", "MA"];

export const DEMO = {
  admin: { email: "admin@demo.test", password: "demo-admin-2026", name: "Avery Admin" },
  investor: { email: "investor@demo.test", password: "demo-investor-2026", name: "Jordan Ellis" },
  othersPassword: "demo-investor-2026",
};
