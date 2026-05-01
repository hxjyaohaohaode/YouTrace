import crypto from 'crypto';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const weatherCache = new Map<string, CacheEntry<unknown>>();
const NOW_CACHE_TTL = 10 * 60 * 1000;
const FORECAST_CACHE_TTL = 30 * 60 * 1000;
const AIR_CACHE_TTL = 30 * 60 * 1000;
const ALERT_CACHE_TTL = 5 * 60 * 1000;

function getQWeatherHost(): string {
  return process.env.QWEATHER_API_HOST || 'api.qweather.com';
}

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateQWeatherJWT(): string | null {
  const privateKey = process.env.QWEATHER_JWT_PRIVATE_KEY;
  const credentialId = process.env.QWEATHER_JWT_CREDENTIAL_ID;
  const projectId = process.env.QWEATHER_JWT_PROJECT_ID;

  if (!privateKey || !credentialId || !projectId) return null;

  try {
    const header = { alg: 'EdDSA', kid: credentialId };
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: projectId, iat: now, exp: now + 3600 };

    const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    const pem = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;

    const signature = crypto.sign(null, Buffer.from(signingInput), {
      key: pem,
      type: 'pkcs8',
      format: 'pem',
    });
    const signatureB64 = base64urlEncode(signature);
    return `${headerB64}.${payloadB64}.${signatureB64}`;
  } catch {
    return null;
  }
}

function getQWeatherAuthHeaders(): Record<string, string> {
  const apiKey = process.env.QWEATHER_API_KEY;
  if (apiKey) {
    return { 'X-QW-Api-Key': apiKey };
  }

  const jwt = generateQWeatherJWT();
  if (jwt) {
    return { 'Authorization': `Bearer ${jwt}` };
  }

  throw new Error('QWeather authentication not configured (need QWEATHER_API_KEY or QWEATHER_JWT_PRIVATE_KEY)');
}

function getFromCache<T>(key: string): T | null {
  const entry = weatherCache.get(key);
  if (!entry) return null;
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttl: number): void {
  weatherCache.set(key, { data, timestamp: Date.now() });
  setTimeout(() => weatherCache.delete(key), ttl);
}

function getGeoApiHost(): string {
  const host = process.env.QWEATHER_GEO_API_HOST;
  if (host) return host;
  const apiHost = getQWeatherHost();
  if (apiHost !== 'api.qweather.com' && apiHost !== 'devapi.qweather.com') {
    return apiHost;
  }
  return 'geoapi.qweather.com';
}

async function resolveQWeatherLocationId(cityName: string): Promise<string | null> {
  const cacheKey = `geo:${cityName}`;
  const cached = getFromCache<string>(cacheKey);
  if (cached !== null) return cached;

  try {
    const geoHost = getGeoApiHost();
    const apiHost = getQWeatherHost();
    const useSameHost = geoHost === apiHost;
    const path = useSameHost ? '/geo/v2/city/lookup' : '/v2/city/lookup';
    const params = new URLSearchParams({
      location: cityName,
      number: '1',
    });
    const url = `https://${geoHost}${path}?${params.toString()}`;

    const headers: Record<string, string> = {
      ...getQWeatherAuthHeaders(),
      'Accept-Encoding': 'gzip',
    };

    const response = await fetch(url, { headers });
    if (!response.ok) return null;

    const data = await response.json() as { code?: string; location?: { id: string }[] };
    if (data.code === '200' && data.location && data.location.length > 0) {
      const id = data.location[0].id;
      setCache(cacheKey, id, 24 * 60 * 60 * 1000);
      return id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function buildQWeatherLocation(
  longitude: number | null,
  latitude: number | null,
  cityName?: string,
): Promise<string> {
  if (longitude != null && latitude != null) {
    return `${longitude.toFixed(2)},${latitude.toFixed(2)}`;
  }

  if (cityName) {
    const id = await resolveQWeatherLocationId(cityName);
    if (id) return id;
  }

  return '101010100';
}

async function qweatherGet(path: string, params: Record<string, string>): Promise<unknown> {
  const host = getQWeatherHost();
  const query = new URLSearchParams(params).toString();
  const url = `https://${host}${path}?${query}`;

  const headers: Record<string, string> = {
    ...getQWeatherAuthHeaders(),
    'Accept-Encoding': 'gzip',
  };

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`QWeather API error: ${response.status} ${errorBody}`);
  }

  const data = await response.json();

  const v1Code = (data as { code?: string }).code;
  if (v1Code && v1Code !== '200') {
    throw new Error(`QWeather API returned code: ${v1Code}`);
  }

  const v2Error = (data as { error?: { status?: number; title?: string; detail?: string } }).error;
  if (v2Error && v2Error.status) {
    throw new Error(`QWeather API error: ${v2Error.status} ${v2Error.title}: ${v2Error.detail || ''}`);
  }

  return data;
}

export interface WeatherNow {
  obsTime: string;
  temp: string;
  feelsLike: string;
  icon: string;
  text: string;
  wind360: string;
  windDir: string;
  windScale: string;
  windSpeed: string;
  humidity: string;
  precip: string;
  pressure: string;
  vis: string;
  cloud: string;
  dew: string;
}

export interface WeatherNowResponse {
  code: string;
  updateTime: string;
  fxLink: string;
  now: WeatherNow;
}

interface DailyForecast {
  fxDate: string;
  sunrise: string;
  sunset: string;
  moonrise: string;
  moonset: string;
  moonPhase: string;
  moonPhaseIcon: string;
  tempMax: string;
  tempMin: string;
  iconDay: string;
  textDay: string;
  iconNight: string;
  textNight: string;
  wind360Day: string;
  windDirDay: string;
  windScaleDay: string;
  windSpeedDay: string;
  wind360Night: string;
  windDirNight: string;
  windScaleNight: string;
  windSpeedNight: string;
  humidity: string;
  precip: string;
  pressure: string;
  vis: string;
  cloud: string;
  uvIndex: string;
}

export interface ForecastResponse {
  code: string;
  updateTime: string;
  fxLink: string;
  daily: DailyForecast[];
}

export interface AirQuality {
  pubTime: string;
  aqi: string;
  level: string;
  category: string;
  primary: string;
  pm10: string;
  pm2p5: string;
  no2: string;
  so2: string;
  co: string;
  o3: string;
}

export interface AirNowResponse {
  code: string;
  updateTime: string;
  fxLink: string;
  now: AirQuality;
  station?: { pubTime: string; name: string; id: string; aqi: string; level: string; category: string; primary: string; pm10: string; pm2p5: string; no2: string; so2: string; co: string; o3: string }[];
}

interface WeatherAlert {
  id: string;
  senderName: string;
  issuedTime: string;
  messageType: { code: string; supersedes?: string[] };
  eventType: { name: string; code: string };
  urgency: string | null;
  severity: string;
  certainty: string | null;
  icon: string;
  color: { code: string; red: number; green: number; blue: number; alpha: number };
  effectiveTime: string;
  onsetTime: string;
  expireTime: string;
  headline: string;
  description: string;
  criteria: string | null;
  instruction: string | null;
}

export interface AlertV1Response {
  metadata: { tag: string; zeroResult: boolean; attributions: string[] };
  alerts: WeatherAlert[];
}

interface AmapWeatherLive {
  province: string;
  city: string;
  adcode: string;
  weather: string;
  temperature: string;
  winddirection: string;
  windpower: string;
  humidity: string;
  reporttime: string;
}

interface AmapWeatherForecast {
  date: string;
  week: string;
  dayweather: string;
  nightweather: string;
  daytemp: string;
  nighttemp: string;
  daywind: string;
  nightwind: string;
  daypower: string;
  nightpower: string;
  daytemp_float: string;
  nighttemp_float: string;
}

export async function getWeatherNow(location: string): Promise<WeatherNowResponse> {
  const cacheKey = `now:${location}`;
  const cached = getFromCache<WeatherNowResponse>(cacheKey);
  if (cached) return cached;

  const data = (await qweatherGet('/v7/weather/now', { location })) as WeatherNowResponse;
  setCache(cacheKey, data, NOW_CACHE_TTL);
  return data;
}

export async function getWeatherForecast(location: string, days: '3d' | '7d' | '10d' | '15d' = '7d'): Promise<ForecastResponse> {
  const cacheKey = `forecast:${location}:${days}`;
  const cached = getFromCache<ForecastResponse>(cacheKey);
  if (cached) return cached;

  const data = (await qweatherGet(`/v7/weather/${days}`, { location })) as ForecastResponse;
  setCache(cacheKey, data, FORECAST_CACHE_TTL);
  return data;
}

export async function getAirQuality(location: string): Promise<AirNowResponse> {
  const cacheKey = `air:${location}`;
  const cached = getFromCache<AirNowResponse>(cacheKey);
  if (cached) return cached;

  const data = (await qweatherGet('/v7/air/now', { location })) as AirNowResponse;
  setCache(cacheKey, data, AIR_CACHE_TTL);
  return data;
}

export async function getWeatherAlerts(latitude: number, longitude: number): Promise<AlertV1Response> {
  const cacheKey = `alert:${latitude},${longitude}`;
  const cached = getFromCache<AlertV1Response>(cacheKey);
  if (cached) return cached;

  const lat = latitude.toFixed(2);
  const lng = longitude.toFixed(2);
  const data = (await qweatherGet(`/weatheralert/v1/current/${lat}/${lng}`, {})) as AlertV1Response;
  setCache(cacheKey, data, ALERT_CACHE_TTL);
  return data;
}

export async function getAmapWeather(adcode: string, extensions: 'base' | 'all' = 'base'): Promise<{
  lives?: AmapWeatherLive[];
  forecasts?: { city: string; adcode: string; province: string; reporttime: string; casts: AmapWeatherForecast[] }[];
}> {
  const key = process.env.AMAP_KEY;
  if (!key) throw new Error('AMAP_KEY not configured');

  const cacheKey = `amap_weather:${adcode}:${extensions}`;
  const cached = getFromCache<unknown>(cacheKey);
  if (cached) return cached as ReturnType<typeof getAmapWeather> extends Promise<infer T> ? T : never;

  const params = new URLSearchParams({ key, city: adcode, extensions, output: 'JSON' });
  const url = `https://restapi.amap.com/v3/weather/weatherInfo?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Amap weather API error: ${response.status}`);
  }

  const data = await response.json() as {
    status: string;
    lives?: AmapWeatherLive[];
    forecasts?: { city: string; adcode: string; province: string; reporttime: string; casts: AmapWeatherForecast[] }[];
  };

  if (data.status !== '1') {
    throw new Error('Amap weather API returned error');
  }

  const result = { lives: data.lives, forecasts: data.forecasts };
  setCache(cacheKey, result, NOW_CACHE_TTL);
  return result;
}

export function getWeatherSummaryText(now: WeatherNow, air?: AirQuality | null, alerts?: WeatherAlert[]): string {
  let summary = `当前天气：${now.text}，温度${now.temp}°C，体感${now.feelsLike}°C，`;
  summary += `${now.windDir}${now.windScale}级，风速${now.windSpeed}km/h，`;
  summary += `湿度${now.humidity}%，降水量${now.precip}mm，气压${now.pressure}hPa，能见度${now.vis}km`;

  if (air) {
    summary += `；空气质量：AQI ${air.aqi}（${air.category}），PM2.5 ${air.pm2p5}，PM10 ${air.pm10}`;
  }

  if (alerts && alerts.length > 0) {
    summary += `；天气预警：${alerts.map((a) => a.headline).join('、')}`;
  }

  return summary;
}
