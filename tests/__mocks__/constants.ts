import { STRINGS } from "./strings";

export const TIME_LABELS = [
  {
    name: "Time: <1 Hour",
  },
  {
    name: "Time: <2 Hours",
  },
  {
    name: "Time: <4 Hours",
  },
  {
    name: "Time: <1 Day",
  },
  {
    name: "Time: <1 Week",
  },
];

export const PRIORITY_LABELS = [
  {
    name: "Priority: 1 (Normal)",
  },
  {
    name: "Priority: 2 (Medium)",
  },
  {
    name: "Priority: 3 (High)",
  },
  {
    name: "Priority: 4 (Urgent)",
  },
  {
    name: "Priority: 5 (Emergency)",
  },
];

export const PRICE_LABELS = [
  { name: "Price: 12.5 USD", color: "1f883d" },
  { name: "Price: 25 USD", color: "1f883d" },
  { name: "Price: 37.5 USD", color: "1f883d" },
  { name: "Price: 50 USD", color: "1f883d" },
  { name: "Price: 62.5 USD", color: "1f883d" },
  { name: "Price: 75 USD", color: "1f883d" },
  { name: "Price: 125 USD", color: "1f883d" },
  { name: "Price: 100 USD", color: "1f883d" },
  { name: "Price: 150 USD", color: "1f883d" },
  { name: "Price: 200 USD", color: "1f883d" },
  { name: "Price: 250 USD", color: "1f883d" },
  { name: "Price: 300 USD", color: "1f883d" },
  { name: "Price: 400 USD", color: "1f883d" },
  { name: "Price: 450 USD", color: "1f883d" },
  { name: "Price: 500 USD", color: "1f883d" },
  { name: "Price: 600 USD", color: "1f883d" },
  { name: "Price: 750 USD", color: "1f883d" },
  { name: "Price: 800 USD", color: "1f883d" },
  { name: "Price: 1000 USD", color: "1f883d" },
];

export const AUTHED_USER = {
  email: STRINGS.EMAIL,
  name: STRINGS.UBIQUITY,
  username: STRINGS.UBIQUITY,
  date: new Date().toISOString(),
};

export const BILLING_MANAGER = {
  email: "billing@dao",
  name: "billing",
  username: "billing",
  date: new Date().toISOString(),
};

export const UNAUTHED_USER = {
  email: "user2@dao",
  name: STRINGS.USER_2,
  username: STRINGS.USER_2,
  date: new Date().toISOString(),
};
export const priceMap: { [key: number]: number } = {
  1: 12.5,
  2: 25,
  3: 37.5,
  4: 50,
  5: 62.5,
  6: 75,
  7: 100,
  8: 125,
  9: 150,
  10: 200,
  11: 250,
  12: 300,
  13: 400,
  14: 500,
  15: 600,
  16: 800,
  17: 1000,
};
