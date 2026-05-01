interface IpLocationResult {
  status: string;
  info: string;
  infocode: string;
  province: string;
  city: string;
  adcode: string;
  rectangle: string;
}

interface RegeoResult {
  status: string;
  info: string;
  infocode: string;
  regeocode: {
    formatted_address: string;
    addressComponent: {
      country: string;
      province: string;
      city: string | [];
      citycode: string;
      district: string;
      adcode: string;
      township: string;
      neighborhood: { name: string; type: string };
      building: { name: string; type: string };
      streetNumber: { street: string; number: string; location: string; direction: string; distance: string };
      businessAreas: { location: string; name: string; id: string }[];
    };
  };
}

interface GeoCodeResult {
  status: string;
  info: string;
  infocode: string;
  count: string;
  geocodes: {
    formatted_address: string;
    country: string;
    province: string;
    city: string;
    district: string;
    township: string;
    street: string;
    number: string;
    adcode: string;
    location: string;
    level: string;
  }[];
}

export interface LocationInfo {
  province: string;
  city: string;
  district: string;
  adcode: string;
  formattedAddress: string;
  longitude: number | null;
  latitude: number | null;
  citycode: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const locationCache = new Map<string, CacheEntry<LocationInfo>>();
const geoCache = new Map<string, CacheEntry<LocationInfo[]>>();
const CACHE_TTL = 30 * 60 * 1000;

function getAmapKey(): string {
  const key = process.env.AMAP_KEY;
  if (!key) throw new Error('AMAP_KEY not configured');
  return key;
}

function getFromCache<T>(key: string, cache: Map<string, CacheEntry<T>>): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(key: string, data: T, cache: Map<string, CacheEntry<T>>): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export async function locateByIp(ip?: string): Promise<LocationInfo> {
  const cacheKey = `ip:${ip || 'auto'}`;
  const cached = getFromCache(cacheKey, locationCache);
  if (cached) return cached;

  const key = getAmapKey();
  const params = new URLSearchParams({ key, output: 'JSON' });
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost') {
    params.set('ip', ip);
  }

  const url = `https://restapi.amap.com/v3/ip?${params.toString()}`;
  let data: IpLocationResult;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Amap IP location API error: ${response.status}`);
    }
    data = (await response.json()) as IpLocationResult;
  } catch {
    return getDefaultLocation();
  }

  if (data.status !== '1' || !data.adcode) {
    const cityValue = Array.isArray(data.city) ? '' : (data.city || '');
    const result: LocationInfo = {
      province: data.province || '',
      city: cityValue,
      district: '',
      adcode: data.adcode || '',
      formattedAddress: `${data.province || ''}${cityValue}`,
      longitude: null,
      latitude: null,
      citycode: '',
    };

    if (!cityValue && !result.province) {
      return getDefaultLocation();
    }

    setCache(cacheKey, result, locationCache);
    return result;
  }

  let longitude: number | null = null;
  let latitude: number | null = null;
  if (data.rectangle && typeof data.rectangle === 'string' && data.rectangle.includes(';')) {
    const parts = data.rectangle.split(';');
    if (parts.length === 2) {
      const p1 = parts[0].split(',').map(Number);
      const p2 = parts[1].split(',').map(Number);
      if (p1.length === 2 && p2.length === 2 && !isNaN(p1[0]) && !isNaN(p2[0])) {
        longitude = Math.round(((p1[0] + p2[0]) / 2) * 1000000) / 1000000;
        latitude = Math.round(((p1[1] + p2[1]) / 2) * 1000000) / 1000000;
      }
    }
  }

  const cityValue = Array.isArray(data.city) ? '' : (data.city || '');
  const result: LocationInfo = {
    province: data.province || '',
    city: cityValue,
    district: '',
    adcode: data.adcode || '',
    formattedAddress: `${data.province || ''}${cityValue}`,
    longitude,
    latitude,
    citycode: '',
  };

  setCache(cacheKey, result, locationCache);
  return result;
}

function getDefaultLocation(): LocationInfo {
  return {
    province: '',
    city: '北京市',
    district: '',
    adcode: '110000',
    formattedAddress: '北京市',
    longitude: 116.4074,
    latitude: 39.9042,
    citycode: '010',
  };
}

export async function reverseGeocode(longitude: number, latitude: number): Promise<LocationInfo> {
  const cacheKey = `regeo:${longitude},${latitude}`;
  const cached = getFromCache(cacheKey, locationCache);
  if (cached) return cached;

  const key = getAmapKey();
  const location = `${longitude},${latitude}`;
  const params = new URLSearchParams({ key, location, extensions: 'base', output: 'JSON' });

  const url = `https://restapi.amap.com/v3/geocode/regeo?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Amap reverse geocode API error: ${response.status}`);
  }

  const data = (await response.json()) as RegeoResult;

  if (data.status !== '1' || !data.regeocode) {
    throw new Error(`Amap reverse geocode failed: ${data.info}`);
  }

  const addr = data.regeocode.addressComponent;
  const cityValue = Array.isArray(addr.city) ? '' : addr.city;

  const result: LocationInfo = {
    province: addr.province || '',
    city: cityValue || addr.province || '',
    district: addr.district || '',
    adcode: addr.adcode || '',
    formattedAddress: data.regeocode.formatted_address || '',
    longitude,
    latitude,
    citycode: addr.citycode || '',
  };

  setCache(cacheKey, result, locationCache);
  return result;
}

export async function searchCity(keyword: string): Promise<LocationInfo[]> {
  if (!keyword || keyword.trim().length === 0) {
    return [];
  }

  const cacheKey = `geo:${keyword.trim()}`;
  const cached = getFromCache(cacheKey, geoCache);
  if (cached) return cached;

  const key = getAmapKey();
  const params = new URLSearchParams({
    key,
    address: keyword.trim(),
    output: 'JSON',
  });

  const url = `https://restapi.amap.com/v3/geocode/geo?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Amap geocode API error: ${response.status}`);
  }

  const data = (await response.json()) as GeoCodeResult;

  if (data.status !== '1' || !data.geocodes || data.geocodes.length === 0) {
    return [];
  }

  const results: LocationInfo[] = data.geocodes.map((item) => {
    let longitude: number | null = null;
    let latitude: number | null = null;
    if (item.location && item.location.includes(',')) {
      const [lng, lat] = item.location.split(',').map(Number);
      if (!isNaN(lng) && !isNaN(lat)) {
        longitude = lng;
        latitude = lat;
      }
    }

    return {
      province: item.province || '',
      city: item.city || '',
      district: item.district || '',
      adcode: item.adcode || '',
      formattedAddress: item.formatted_address || '',
      longitude,
      latitude,
      citycode: '',
    };
  });

  setCache(cacheKey, results, geoCache);
  return results;
}

export async function getLocation(ip?: string, longitude?: number, latitude?: number): Promise<LocationInfo> {
  if (longitude != null && latitude != null) {
    return reverseGeocode(longitude, latitude);
  }
  return locateByIp(ip);
}
