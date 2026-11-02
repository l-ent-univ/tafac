import universityConfig from '@university'

const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODING_API_URL = 'https://geocoding-api.open-meteo.com/v1'
const REVERSE_GEOCODING_API_URL = 'https://nominatim.openstreetmap.org/reverse'
const DEFAULT_FALLBACK_LOCATION = universityConfig.features?.weather?.defaultCity || 'Paris'
function buildWeatherGradient(color) {
  return `linear-gradient(180deg, ${color} 0%, transparent 55%)`
}

function buildWeatherGradientDark(color) {
  return `linear-gradient(180deg, ${color} 0%, transparent 55%)`
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl)
  url.search = new URLSearchParams(params).toString()
  return url.toString()
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })

  if (!response.ok) {
    throw new Error(`La requête météo a échoué (${response.status}).`)
  }

  return response.json()
}

function formatLocation(result) {
  const primaryName = result?.name ?? result?.city ?? result?.admin2 ?? result?.admin1 ?? 'Position inconnue'
  const countryCode = result?.country_code ?? ''
  return countryCode ? `${primaryName}, ${countryCode}` : primaryName
}

function formatNearestCity(address = {}) {
  const primaryName = address.city
    ?? address.town
    ?? address.village
    ?? address.municipality
    ?? address.county
    ?? address.state_district
    ?? address.state
    ?? DEFAULT_FALLBACK_LOCATION
  const countryCode = address.country_code?.toUpperCase() ?? 'FR'

  return countryCode ? `${primaryName}, ${countryCode}` : primaryName
}

function getWeatherDescriptor(weatherCode, isDay) {
  const dayPartlyCloudyIcon = isDay ? 'ph:cloud-sun' : 'ph:cloud-moon'
  const dayMostlyCloudyIcon = isDay ? 'ph:cloud' : 'ph:cloud-moon'

  if (weatherCode === 0) {
    return {
      label: isDay ? 'Ensoleillé' : 'Dégagé',
      icon: dayPartlyCloudyIcon,
      gradient: isDay
        ? buildWeatherGradient('#fde68a')
        : buildWeatherGradient('#c4b5fd'),
      gradientDark: isDay
        ? buildWeatherGradientDark('#5c3d0e')
        : buildWeatherGradientDark('#2e1065'),
    }
  }

  if ([1, 2].includes(weatherCode)) {
    return {
      label: 'Partiellement nuageux',
      icon: dayPartlyCloudyIcon,
      gradient: isDay
        ? buildWeatherGradient('#fed7aa')
        : buildWeatherGradient('#c7d2fe'),
      gradientDark: isDay
        ? buildWeatherGradientDark('#5c350e')
        : buildWeatherGradientDark('#261452'),
    }
  }

  if (weatherCode === 3) {
    return {
      label: 'Couvert',
      icon: dayMostlyCloudyIcon,
      gradient: buildWeatherGradient('#c8d5e6'),
      gradientDark: buildWeatherGradientDark('#1c2a42'),
    }
  }

  if ([45, 48].includes(weatherCode)) {
    return {
      label: 'Brouillard',
      icon: 'ph:cloud',
      gradient: buildWeatherGradient('#d4cce8'),
      gradientDark: buildWeatherGradientDark('#221e38'),
    }
  }

  if ([51, 53, 55, 56, 57].includes(weatherCode)) {
    return {
      label: 'Bruine',
      icon: 'ph:cloud',
      gradient: buildWeatherGradient('#bae6fd'),
      gradientDark: buildWeatherGradientDark('#0e2a48'),
    }
  }

  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return {
      label: 'Pluie',
      icon: 'ph:cloud',
      gradient: buildWeatherGradient('#a5b4fc'),
      gradientDark: buildWeatherGradientDark('#1a2558'),
    }
  }

  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    return {
      label: 'Neige',
      icon: 'ph:cloud',
      gradient: buildWeatherGradient('#c7d2fe'),
      gradientDark: buildWeatherGradientDark('#1c2450'),
    }
  }

  if ([95, 96, 99].includes(weatherCode)) {
    return {
      label: 'Orage',
      icon: 'ph:cloud',
      gradient: buildWeatherGradient('#c4b5fd'),
      gradientDark: buildWeatherGradientDark('#2a1060'),
    }
  }

  return {
    label: 'Conditions variables',
    icon: 'ph:cloud',
    gradient: buildWeatherGradient('#bfdbfe'),
    gradientDark: buildWeatherGradientDark('#1a2540'),
  }
}

function extractWeatherPayload(weatherResponse, locationLabel) {
  const currentWeather = weatherResponse?.current_weather

  if (!currentWeather) {
    throw new Error('Les données météo sont indisponibles.')
  }

  const weatherCode = currentWeather.weathercode
  const descriptor = getWeatherDescriptor(weatherCode, Boolean(currentWeather.is_day))
  const roundedTemperature = Math.round(currentWeather.temperature)

  return {
    summary: `${roundedTemperature}°C, ${descriptor.label}`,
    location: locationLabel,
    icon: descriptor.icon,
    gradient: descriptor.gradient,
    gradientDark: descriptor.gradientDark,
  }
}

function getCurrentPosition() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('La géolocalisation n’est pas disponible sur cet appareil.'))
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
        })
      },
      () => reject(new Error('La position actuelle n’a pas pu être récupérée.')),
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 30 * 60 * 1000,
      },
    )
  })
}

async function getNearestCityForCoordinates(latitude, longitude) {
  const reverseUrl = buildUrl(REVERSE_GEOCODING_API_URL, {
    lat: String(latitude),
    lon: String(longitude),
    format: 'jsonv2',
    zoom: '10',
    addressdetails: '1',
    'accept-language': 'fr',
  })

  try {
    const reverseResponse = await fetchJson(reverseUrl, {
      headers: {
        'Accept-Language': 'fr',
      },
    })

    return formatNearestCity(reverseResponse?.address)
  } catch {
    return DEFAULT_FALLBACK_LOCATION
  }
}

export async function getWeatherForCoordinates(latitude, longitude) {
  const weatherUrl = buildUrl(WEATHER_API_URL, {
    latitude: String(latitude),
    longitude: String(longitude),
    current_weather: 'true',
    timezone: 'auto',
  })

  const [weatherResponse, locationLabel] = await Promise.all([
    fetchJson(weatherUrl),
    getNearestCityForCoordinates(latitude, longitude),
  ])

  return extractWeatherPayload(weatherResponse, locationLabel)
}

export async function getWeatherForQuery(query) {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    throw new Error('Merci de saisir une ville ou un code postal.')
  }

  const searchUrl = buildUrl(`${GEOCODING_API_URL}/search`, {
    name: trimmedQuery,
    count: '1',
    language: 'fr',
    format: 'json',
  })

  const searchResponse = await fetchJson(searchUrl)
  const locationResult = searchResponse?.results?.[0]

  if (!locationResult) {
    throw new Error('Aucune localité trouvée.')
  }

  const weatherPayload = await getWeatherForCoordinates(locationResult.latitude, locationResult.longitude)

  return {
    ...weatherPayload,
    location: formatLocation(locationResult),
  }
}

export async function getCurrentLocationWeather() {
  try {
    const coords = await getCurrentPosition()
    return getWeatherForCoordinates(coords.latitude, coords.longitude)
  } catch {
    return getWeatherForQuery(DEFAULT_FALLBACK_LOCATION)
  }
}

export function getEditableLocationLabel(locationLabel) {
  return locationLabel.split(',')[0]?.trim() ?? ''
}
