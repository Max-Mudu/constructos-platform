/** Human labels for the content enums. */
import type { DelayCause, IncidentType, WeatherCondition } from '@/lib/daily-report-types';

export const WEATHER_LABELS: Record<WeatherCondition, string> = {
  sunny: 'Sunny',
  cloudy: 'Cloudy',
  light_rain: 'Light rain',
  heavy_rain: 'Heavy rain',
  windy: 'Windy',
  storm: 'Storm',
  hot: 'Hot',
  cold: 'Cold',
  other: 'Other',
};

export const DELAY_CAUSE_LABELS: Record<DelayCause, string> = {
  weather: 'Weather',
  late_materials: 'Late materials',
  equipment_breakdown: 'Equipment breakdown',
  labour_shortage: 'Labour shortage',
  awaiting_information: 'Awaiting information',
  client_or_consultant_instruction: 'Client / consultant instruction',
  inspection_or_authority: 'Inspection / authority',
  utilities: 'Utilities (power, water)',
  site_access: 'Site access',
  safety_stoppage: 'Safety stoppage',
  subcontractor: 'Subcontractor',
  other: 'Other',
};

export const INCIDENT_LABELS: Record<IncidentType, string> = {
  near_miss: 'Near miss',
  first_aid: 'First aid',
  lost_time: 'Lost-time injury',
  property_damage: 'Property damage',
  environmental: 'Environmental',
  other: 'Other',
};

export function yesNo(v: boolean | null): string {
  if (v === null) return 'Not stated';
  return v ? 'Yes' : 'No';
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(n);
}
