import { useEffect, useState, useCallback, useRef } from 'react';
import { useWeatherStore } from '../stores/weatherStore';
import { useLocationStore } from '../stores/locationStore';
import type { WeatherAlert, DailyForecast, AirQuality, LocationInfo } from '../types';

const WEATHER_ICONS: Record<string, string> = {
  '100': '☀️', '101': '🌤️', '102': '🌤️', '103': '⛅', '104': '☁️',
  '150': '🌙', '151': '🌙', '152': '🌙', '153': '🌙',
  '300': '🌦️', '301': '🌦️', '302': '⛈️', '303': '⛈️', '304': '🌩️',
  '305': '🌧️', '306': '🌧️', '307': '🌧️', '308': '🌧️', '309': '🌧️',
  '310': '🌧️', '311': '🌧️', '312': '🌧️', '313': '🌧️', '314': '🌦️',
  '399': '🌧️', '400': '🌨️', '401': '🌨️', '402': '❄️', '403': '❄️',
  '404': '🌧️', '405': '🌧️', '406': '🌨️', '407': '🌨️', '408': '🌨️',
  '409': '🌨️', '410': '❄️', '499': '❄️',
  '500': '🌫️', '501': '🌫️', '502': '🌫️', '503': '🌫️', '504': '🌫️',
  '507': '😷', '508': '😷', '509': '😷', '510': '😷', '511': '🌫️',
  '512': '🌫️', '513': '🌫️', '514': '🌫️', '515': '🌫️',
  '900': '🥵', '901': '🥶', '999': '❓',
};

function getWeatherIcon(code: string): string {
  return WEATHER_ICONS[code] || '❓';
}

function getAqiColor(aqi: number): string {
  if (aqi <= 50) return 'text-green-500';
  if (aqi <= 100) return 'text-yellow-500';
  if (aqi <= 150) return 'text-orange-500';
  if (aqi <= 200) return 'text-red-500';
  if (aqi <= 300) return 'text-purple-500';
  return 'text-rose-700';
}

function getAqiBg(aqi: number): string {
  if (aqi <= 50) return 'bg-green-50 dark:bg-green-950/30';
  if (aqi <= 100) return 'bg-yellow-50 dark:bg-yellow-950/30';
  if (aqi <= 150) return 'bg-orange-50 dark:bg-orange-950/30';
  if (aqi <= 200) return 'bg-red-50 dark:bg-red-950/30';
  return 'bg-purple-50 dark:bg-purple-950/30';
}

function getAlertSeverityColor(severity: string): { bg: string; text: string; border: string } {
  switch (severity) {
    case 'extreme': return { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800' };
    case 'severe': return { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800' };
    case 'moderate': return { bg: 'bg-yellow-50 dark:bg-yellow-950/30', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-800' };
    default: return { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800' };
  }
}

function formatWeekday(dateStr: string): string {
  const date = new Date(dateStr);
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return '今天';
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return '明天';
  return days[date.getDay()];
}

function AlertCard({ alert }: { alert: WeatherAlert }) {
  const [expanded, setExpanded] = useState(false);
  const colors = getAlertSeverityColor(alert.severity);

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-3 cursor-pointer`} onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-2">
        <span className="text-lg flex-shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${colors.text}`}>{alert.headline}</p>
          <p className="text-xs text-surface-400 mt-0.5">
            {alert.senderName} 发布 {new Date(alert.issuedTime).toLocaleString('zh-CN')}
          </p>
          {expanded && (
            <div className="mt-2 space-y-2">
              {alert.description && (
                <p className="text-xs text-surface-600 leading-relaxed">{alert.description}</p>
              )}
              {alert.instruction && (
                <div className="bg-white/50 dark:bg-surface-800/50 rounded-lg p-2">
                  <p className="text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">防御指引：</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">{alert.instruction}</p>
                </div>
              )}
            </div>
          )}
        </div>
        <svg className={`w-4 h-4 ${colors.text} transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

function ForecastCard({ day }: { day: DailyForecast }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-surface-50 dark:border-surface-800 last:border-0">
      <div className="w-12 text-sm text-surface-600 dark:text-surface-400">{formatWeekday(day.fxDate)}</div>
      <div className="flex items-center gap-1 w-20">
        <span className="text-base">{getWeatherIcon(day.iconDay)}</span>
        <span className="text-xs text-surface-500 dark:text-surface-400">{day.textDay}</span>
      </div>
      <div className="flex items-center gap-1 w-16 justify-center">
        <span className="text-xs text-surface-400">💧{day.humidity}%</span>
      </div>
      <div className="flex items-center gap-2 w-24 justify-end">
        <span className="text-sm font-medium text-surface-700 dark:text-surface-300">{day.tempMax}°</span>
        <div className="w-12 h-1 rounded-full bg-surface-200 dark:bg-surface-700 relative overflow-hidden">
          <div
            className="absolute inset-y-0 rounded-full gradient-bg"
            style={{
              left: `${((parseInt(day.tempMin) + 20) / 60) * 100}%`,
              right: `${100 - ((parseInt(day.tempMax) + 20) / 60) * 100}%`,
            }}
          />
        </div>
        <span className="text-sm text-surface-400">{day.tempMin}°</span>
      </div>
    </div>
  );
}

function AirQualityCard({ air }: { air: AirQuality }) {
  const aqi = parseInt(air.aqi) || 0;
  const percentage = Math.min((aqi / 300) * 100, 100);

  return (
    <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">空气质量</h3>
      <div className="flex items-center gap-4 mb-3">
        <div className={`w-14 h-14 rounded-xl ${getAqiBg(aqi)} flex items-center justify-center`}>
          <span className={`text-xl font-bold ${getAqiColor(aqi)}`}>{air.aqi}</span>
        </div>
        <div>
          <p className={`text-lg font-semibold ${getAqiColor(aqi)}`}>{air.category}</p>
          <p className="text-xs text-surface-400">
            {air.primary !== 'NA' ? `主要污染物: ${air.primary}` : '空气质量良好'}
          </p>
        </div>
      </div>
      <div className="w-full h-2 rounded-full bg-surface-100 dark:bg-surface-800 mb-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percentage}%`,
            background: aqi <= 50 ? '#22c55e' : aqi <= 100 ? '#eab308' : aqi <= 150 ? '#f97316' : aqi <= 200 ? '#ef4444' : '#a855f7',
          }}
        />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: 'PM2.5', value: air.pm2p5 },
          { label: 'PM10', value: air.pm10 },
          { label: 'O₃', value: air.o3 },
          { label: 'NO₂', value: air.no2 },
          { label: 'SO₂', value: air.so2 },
          { label: 'CO', value: air.co },
        ].map((item) => (
          <div key={item.label} className="text-center p-1.5 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs text-surface-400">{item.label}</p>
            <p className="text-sm font-medium text-surface-700 dark:text-surface-300">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getLifeSuggestions(
  now: { temp: string; humidity: string; text: string; windScale: string; vis: string; precip: string },
  air?: AirQuality | null,
): { icon: string; label: string; value: string }[] {
  const temp = parseInt(now.temp) || 20;
  const humidity = parseInt(now.humidity) || 50;
  const suggestions: { icon: string; label: string; value: string }[] = [];

  if (temp >= 35) suggestions.push({ icon: '🔥', label: '炎热', value: '注意防暑降温' });
  else if (temp >= 28) suggestions.push({ icon: '☀️', label: '高温', value: '建议穿透气衣物' });
  else if (temp >= 20) suggestions.push({ icon: '😊', label: '舒适', value: '适合户外活动' });
  else if (temp >= 10) suggestions.push({ icon: '🌤️', label: '微凉', value: '适当添加衣物' });
  else if (temp >= 0) suggestions.push({ icon: '❄️', label: '寒冷', value: '注意保暖' });
  else suggestions.push({ icon: '🥶', label: '严寒', value: '减少外出' });

  if (now.text.includes('雨')) suggestions.push({ icon: '🌧️', label: '下雨', value: '记得带伞' });
  else if (now.text.includes('雪')) suggestions.push({ icon: '🌨️', label: '下雪', value: '注意路滑' });
  else suggestions.push({ icon: '😎', label: '防晒', value: temp > 25 ? '注意涂防晒' : '无需防晒' });

  if (humidity >= 80) suggestions.push({ icon: '💧', label: '潮湿', value: '注意除湿' });
  else if (humidity <= 30) suggestions.push({ icon: '🏜️', label: '干燥', value: '注意补水' });
  else suggestions.push({ icon: '✅', label: '湿度', value: '湿度适宜' });

  if (air) {
    const aqi = parseInt(air.aqi) || 0;
    if (aqi > 150) suggestions.push({ icon: '😷', label: '污染', value: '减少户外活动' });
    else if (aqi > 100) suggestions.push({ icon: '⚠️', label: '轻度', value: '减少外出' });
    else suggestions.push({ icon: '👍', label: '空气', value: '适合开窗' });
  } else {
    if (parseInt(now.vis) < 5) suggestions.push({ icon: '🌫️', label: '低能见度', value: '出行注意安全' });
    else suggestions.push({ icon: '🏃', label: '运动', value: '适合户外运动' });
  }

  return suggestions;
}

function WeatherPage() {
  const { currentWeather, forecast, isLoading, error, refreshAll } = useWeatherStore();
  const { location, coords, searchResults, permissionStatus, requestBrowserLocation, searchCity, clearSearch } = useLocationStore();
  const [showAlerts, setShowAlerts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationInfo | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearch(false);
        clearSearch();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [clearSearch]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const initLocation = async () => {
      if (coords?.lng && coords?.lat) {
        refreshAll({ lng: coords.lng, lat: coords.lat });
        return;
      }
      const browserCoords = await requestBrowserLocation();
      if (browserCoords) {
        refreshAll({ lng: browserCoords.lng, lat: browserCoords.lat });
      } else {
        refreshAll();
      }
    };
    initLocation().catch(() => {
      refreshAll();
    });
  }, [coords, refreshAll, requestBrowserLocation]);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.trim().length >= 2) {
      searchCity(value);
    } else {
      clearSearch();
    }
  }, [searchCity, clearSearch]);

  const handleSelectCity = useCallback((city: LocationInfo) => {
    setSelectedLocation(city);
    setShowSearch(false);
    setSearchQuery('');
    clearSearch();
    if (city.longitude && city.latitude) {
      refreshAll({ lng: city.longitude, lat: city.latitude });
    } else if (city.city) {
      refreshAll({ location: city.city });
    }
  }, [refreshAll, clearSearch]);

  const handleRefresh = useCallback(async () => {
    if (selectedLocation?.longitude && selectedLocation?.latitude) {
      await refreshAll({ lng: selectedLocation.longitude, lat: selectedLocation.latitude });
    } else if (coords?.lng && coords?.lat) {
      await refreshAll({ lng: coords.lng, lat: coords.lat });
    } else if (location?.longitude && location?.latitude) {
      await refreshAll({ lng: location.longitude, lat: location.latitude });
    } else {
      await refreshAll();
    }
  }, [selectedLocation, coords, location, refreshAll]);

  const handleRequestLocation = useCallback(async () => {
    const browserCoords = await requestBrowserLocation();
    if (browserCoords) {
      setSelectedLocation(null);
      await refreshAll({ lng: browserCoords.lng, lat: browserCoords.lat });
    }
  }, [requestBrowserLocation, refreshAll]);

  const now = currentWeather?.now;
  const air = currentWeather?.air;
  const alerts = currentWeather?.alerts || [];
  const loc = selectedLocation || currentWeather?.location || location;

  const locationName = loc
    ? `${loc.city}${loc.district ? ` · ${loc.district}` : ''}` || loc.formattedAddress || '未知位置'
    : '定位中...';

  if (isLoading && !currentWeather) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 mx-auto border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-surface-400">获取天气数据中...</p>
        </div>
      </div>
    );
  }

  if (error && !currentWeather) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-surface-600 dark:text-surface-400 mb-4">{error}</p>
          <button onClick={handleRefresh} className="btn-primary px-6 py-2.5 text-sm">重新获取</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-950/40 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold text-surface-800 dark:text-surface-100">天气</h1>
                <p className="text-xs text-surface-400 truncate">{locationName}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowSearch(!showSearch)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
                title="搜索城市"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button
                onClick={handleRequestLocation}
                className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors ${permissionStatus === 'granted' ? 'text-green-500' : 'text-surface-500'
                  }`}
                title="获取当前位置"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              {alerts.length > 0 && (
                <button
                  onClick={() => setShowAlerts(!showAlerts)}
                  className="relative w-9 h-9 rounded-xl flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-800 text-orange-500 transition-colors"
                  title="天气预警"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-orange-500 text-white text-2xs rounded-full flex items-center justify-center font-semibold">
                    {alerts.length > 9 ? '9+' : alerts.length}
                  </span>
                </button>
              )}
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors disabled:opacity-40"
                title="刷新数据"
              >
                <svg className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {showSearch && (
            <div ref={searchRef} className="mt-3">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="搜索城市（如：上海、北京、广州...）"
                  className="w-full px-4 py-2.5 pr-10 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-sm text-surface-800 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
                  autoFocus
                />
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              {searchResults.length > 0 && (
                <div className="mt-2 bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 shadow-card overflow-hidden">
                  {searchResults.map((result, index) => (
                    <button
                      key={index}
                      onClick={() => handleSelectCity(result)}
                      className="w-full px-4 py-3 text-left hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors border-b border-surface-50 dark:border-surface-700 last:border-0"
                    >
                      <p className="text-sm font-medium text-surface-700 dark:text-surface-200">{result.formattedAddress}</p>
                      <p className="text-xs text-surface-400 mt-0.5">
                        {result.longitude && result.latitude ? `${result.longitude.toFixed(4)}, ${result.latitude.toFixed(4)}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <p className="mt-2 text-xs text-surface-400 text-center">未找到匹配城市</p>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl lg:max-w-4xl mx-auto px-5 sm:px-8 lg:px-12 py-4 space-y-4">
        {now && (
          <div className="bg-gradient-to-br from-brand-400 via-brand-500 to-blue-600 rounded-2xl p-5 sm:p-6 lg:p-8 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
              <span className="text-8xl">{getWeatherIcon(now.icon)}</span>
            </div>
            <div className="relative z-10">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm opacity-80">{now.text}</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-5xl sm:text-6xl lg:text-7xl font-light">{now.temp}</span>
                    <span className="text-2xl">°C</span>
                  </div>
                  <p className="text-sm opacity-70 mt-1">体感 {now.feelsLike}°C</p>
                </div>
                <span className="text-5xl sm:text-6xl lg:text-7xl">{getWeatherIcon(now.icon)}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:gap-4 mt-4 pt-4 border-t border-white/20">
                <div className="text-center">
                  <p className="text-xs opacity-60">湿度</p>
                  <p className="text-sm font-medium mt-0.5">{now.humidity}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs opacity-60">风力</p>
                  <p className="text-sm font-medium mt-0.5">{now.windDir}{now.windScale}级</p>
                </div>
                <div className="text-center">
                  <p className="text-xs opacity-60">降水量</p>
                  <p className="text-sm font-medium mt-0.5">{now.precip}mm</p>
                </div>
                <div className="text-center">
                  <p className="text-xs opacity-60">能见度</p>
                  <p className="text-sm font-medium mt-0.5">{now.vis}km</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:gap-4 mt-3">
                <div className="text-center">
                  <p className="text-xs opacity-60">气压</p>
                  <p className="text-sm font-medium mt-0.5">{now.pressure}hPa</p>
                </div>
                <div className="text-center">
                  <p className="text-xs opacity-60">风速</p>
                  <p className="text-sm font-medium mt-0.5">{now.windSpeed}km/h</p>
                </div>
                <div className="text-center">
                  <p className="text-xs opacity-60">云量</p>
                  <p className="text-sm font-medium mt-0.5">{now.cloud || '-'}%</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAlerts && alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {air && <AirQualityCard air={air} />}

          {forecast && forecast.daily.length > 0 && (
            <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-2">7日预报</h3>
              {forecast.daily.map((day) => (
                <ForecastCard key={day.fxDate} day={day} />
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {forecast && forecast.daily.length > 0 && (
            <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">日出日落</h3>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {forecast.daily.slice(0, 1).map((day) => (
                  <div key={day.fxDate} className="contents">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 dark:bg-orange-950/30">
                      <span className="text-2xl">🌅</span>
                      <div>
                        <p className="text-xs text-surface-400">日出</p>
                        <p className="text-sm font-semibold text-surface-700 dark:text-surface-300">{day.sunrise || '--'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-50 dark:bg-purple-950/30">
                      <span className="text-2xl">🌇</span>
                      <div>
                        <p className="text-xs text-surface-400">日落</p>
                        <p className="text-sm font-semibold text-surface-700 dark:text-surface-300">{day.sunset || '--'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {now && (
            <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">生活建议</h3>
              <div className="grid grid-cols-2 gap-2">
                {getLifeSuggestions(now, air).map((s, i) => (
                  <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-surface-50 dark:bg-surface-800">
                    <span className="text-xl">{s.icon}</span>
                    <div>
                      <p className="text-xs font-medium text-surface-700 dark:text-surface-300">{s.label}</p>
                      <p className="text-2xs text-surface-400">{s.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default WeatherPage;
