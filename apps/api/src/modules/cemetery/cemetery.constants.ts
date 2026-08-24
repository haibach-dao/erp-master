export const GRAVE_PLOT_STATUSES = [
  'Available',
  'Held',
  'Reserved',
  'Allocated',
  'Occupied',
  'Maintenance',
  'Locked',
] as const;

export type GravePlotStatus = (typeof GRAVE_PLOT_STATUSES)[number];
