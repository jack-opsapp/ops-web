export interface WeatherForecast {
  id: string;
  projectId: string;
  companyId: string;
  forecastDate: string;
  tempHighC: number | null;
  tempLowC: number | null;
  tempCurrentC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  windSpeedKmh: number | null;
  conditions: string | null;
  retrievedAt: string;
  source: "open-meteo";
}

export interface WeatherSummary {
  current: WeatherForecast | null;
  forecast: WeatherForecast[];
  attribution: "Weather data by Open-Meteo.com";
}
